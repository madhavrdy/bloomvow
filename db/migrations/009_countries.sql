-- More markets, switched OFF until launch: India, plus regions for Canada, UK,
-- Australia and India. New countries/regions can also be added in Admin >
-- Cities & categories.

insert into countries (code, name, currency, active) values
  ('in', 'India', 'INR', false),
  ('nz', 'New Zealand', 'NZD', false),
  ('ie', 'Ireland', 'EUR', false)
on conflict (code) do nothing;

insert into regions (country_code, code, name, slug)
select c, lower(code), name, slugify(name) from (values
  -- Canada
  ('ca','AB','Alberta'),('ca','BC','British Columbia'),('ca','MB','Manitoba'),('ca','NB','New Brunswick'),
  ('ca','NL','Newfoundland and Labrador'),('ca','NS','Nova Scotia'),('ca','ON','Ontario'),('ca','PE','Prince Edward Island'),
  ('ca','QC','Quebec'),('ca','SK','Saskatchewan'),('ca','NT','Northwest Territories'),('ca','NU','Nunavut'),('ca','YT','Yukon'),
  -- United Kingdom
  ('uk','ENG','England'),('uk','SCT','Scotland'),('uk','WLS','Wales'),('uk','NIR','Northern Ireland'),
  -- Australia
  ('au','NSW','New South Wales'),('au','VIC','Victoria'),('au','QLD','Queensland'),('au','WA','Western Australia'),
  ('au','SA','South Australia'),('au','TAS','Tasmania'),('au','ACT','Australian Capital Territory'),('au','NT','Northern Territory'),
  -- India (states and union territories)
  ('in','AP','Andhra Pradesh'),('in','AR','Arunachal Pradesh'),('in','AS','Assam'),('in','BR','Bihar'),('in','CT','Chhattisgarh'),
  ('in','GA','Goa'),('in','GJ','Gujarat'),('in','HR','Haryana'),('in','HP','Himachal Pradesh'),('in','JH','Jharkhand'),
  ('in','KA','Karnataka'),('in','KL','Kerala'),('in','MP','Madhya Pradesh'),('in','MH','Maharashtra'),('in','MN','Manipur'),
  ('in','ML','Meghalaya'),('in','MZ','Mizoram'),('in','NL','Nagaland'),('in','OR','Odisha'),('in','PB','Punjab'),
  ('in','RJ','Rajasthan'),('in','SK','Sikkim'),('in','TN','Tamil Nadu'),('in','TG','Telangana'),('in','TR','Tripura'),
  ('in','UP','Uttar Pradesh'),('in','UK','Uttarakhand'),('in','WB','West Bengal'),('in','AN','Andaman and Nicobar Islands'),
  ('in','CH','Chandigarh'),('in','DH','Dadra and Nagar Haveli and Daman and Diu'),('in','DL','Delhi'),('in','JK','Jammu and Kashmir'),
  ('in','LA','Ladakh'),('in','LD','Lakshadweep'),('in','PY','Puducherry'),
  -- New Zealand
  ('nz','AUK','Auckland'),('nz','WGN','Wellington'),('nz','CAN','Canterbury'),('nz','OTA','Otago'),('nz','WKO','Waikato'),('nz','BOP','Bay of Plenty'),
  -- Ireland
  ('ie','L','Leinster'),('ie','M','Munster'),('ie','C','Connacht'),('ie','U','Ulster')
) s(c, code, name)
on conflict do nothing;
