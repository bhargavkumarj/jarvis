-- Local synthetic admission only. No accounts, passwords or tokens are seeded.
insert into private.admissions(email) values
  ('alex@example.test'), ('sam@example.test'), ('recovery@example.test')
on conflict do nothing;
