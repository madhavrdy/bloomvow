# Going live: step-by-step

Everything below is done in web browsers. Never paste passwords or secret keys into chat.

## 1. Brand and domain
1. Pick the name and buy the domain (Hostinger works).
2. In GitHub › `bloomvow` › Settings › Secrets and variables › Actions › **Variables**, add:
   * `SITE_URL` = `https://www.yourdomain.com`
   * `SITE_NAME` = your brand name
   * `CONTACT_EMAIL` = your public contact address
   * `FTP_DIR` (only if your site folder isn't `public_html/`)
3. Ask Claude to regenerate the share image and update `PUBLIC_SOCIAL_LINKS` once you have social profiles.

## 2. Hostinger
1. hPanel › Websites › **Add website** for the new domain, choosing an empty site (no WordPress). Your other sites are untouched.
2. hPanel › Files › **FTP accounts**: create an FTP account limited to the new site's folder.
3. In GitHub › Secrets (not Variables), add `FTP_HOST`, `FTP_USER` and `FTP_PASS`.
4. GitHub › Actions › **Build and deploy** › Run workflow. Only changed files are uploaded each time. It also runs every 3 hours.
5. hPanel › SSL: make sure the free SSL is active.

## 3. Supabase
1. Authentication › URL Configuration: set **Site URL** to your domain, and add `https://www.yourdomain.com/**` to the redirect URLs.
2. Add the `SUPABASE_DB_URL` GitHub secret (Connect › **Session pooler** string with your database password).
3. Approve migration 012 (emails) when Claude retries it, then switch on email:
   * Create a free **Resend** account and verify your domain (DNS records in hPanel).
   * In the Supabase SQL editor, run:
     * `select vault.create_secret('<resend key>', 'resend_api_key');`
     * `update settings set value = '"Brand <hello@yourdomain.com>"' where key = 'email_from';`
     * `update settings set value = '"https://www.yourdomain.com"' where key = 'site_url';`

## 4. Real vendors in, sample data out
1. GitHub › Actions › **Import vendors**: run once with dry run ticked, check `vendors-csv`, then run with dry run unticked.
2. In the Supabase SQL editor, run `delete from vendors where source = 'sample';`.
3. Create your own admin login: sign up at `/vendor-dashboard/`, then ask Claude to make that email an admin.

## 5. Before announcing
* Write the privacy policy and terms (`web/src/pages/privacy.astro`, `terms.astro`), and set the Featured plan price on the For vendors page.
* Google Search Console and Bing Webmaster Tools: add the domain and submit `/sitemap.xml`.
* Write intros and guides for your top 20 city pages (Admin › Page content, or CSV import).
