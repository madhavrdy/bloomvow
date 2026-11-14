-- Email pacing: Resend allows 10 requests a second (and 100 emails a day on the free plan),
-- so send at most 8 per minute. A failed email waits longer before each retry (15, 30, 45...
-- minutes) instead of using up its 5 tries in 5 minutes; "domain not verified" and "too many
-- requests" don't use up a try at all.
alter table notifications add column if not exists next_attempt_at timestamptz;

create or replace function send_pending_emails() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  api_key text := email_api_key();
  sender text := (select s.value #>> '{}' from settings s where s.key = 'email_from');
  n notifications; r record; e record; sent int := 0; queued int := 0; soft boolean;
begin
  for n in select * from notifications where sent_at is null and request_id is not null loop
    select * into r from email_http_result(n.request_id);
    if r.ok is null then
      if n.created_at < now() - interval '1 day' then update notifications set request_id = null, error = 'no response' where id = n.id; end if;
    elsif r.ok then update notifications set sent_at = now(), error = null where id = n.id; sent := sent + 1;
    else
      soft := r.err ~* '(not verified|429|too many requests|rate limit)';
      update notifications set request_id = null, error = r.err,
        attempts = case when soft then greatest(attempts - 1, 0) else attempts end,
        next_attempt_at = now() + case when soft then interval '10 minutes' else make_interval(mins => 15 * greatest(attempts, 1)) end
      where id = n.id;
    end if;
  end loop;

  if api_key is null then return jsonb_build_object('sent', sent, 'queued', 0, 'note', 'no resend_api_key in vault'); end if;
  update notifications set attempts = 5, error = 'expired: not sent within 7 days'
  where sent_at is null and request_id is null and attempts < 5 and created_at < now() - interval '7 days';
  for n in select * from notifications where sent_at is null and request_id is null and attempts < 5
           and (next_attempt_at is null or next_attempt_at <= now())
           and kind in ('lead_to_vendor', 'reply_to_couple', 'lead_reminder', 'claim_decided', 'lead_confirmation', 'customer_message', 'customer_link')
           order by created_at limit 8 for update skip locked loop
    select * into e from render_email(n);
    if e.subject is null then
      update notifications set attempts = 5, error = 'skipped' where id = n.id;
      continue;
    end if;
    update notifications set attempts = attempts + 1, request_id = email_http_post(jsonb_strip_nulls(jsonb_build_object(
      'from', sender, 'to', jsonb_build_array(n.to_email), 'subject', e.subject, 'html', e.html, 'reply_to', e.reply_to)), api_key)
    where id = n.id;
    queued := queued + 1;
  end loop;
  return jsonb_build_object('sent', sent, 'queued', queued);
end $$;
revoke execute on function send_pending_emails() from public, anon, authenticated;

-- Give the emails that failed on "not verified" / "too many requests" their tries back.
update notifications set attempts = 0, next_attempt_at = null
where sent_at is null and created_at > now() - interval '7 days'
  and (error ~* '(not verified|429|too many requests|rate limit)' or (attempts > 0 and request_id is null and error is null));
