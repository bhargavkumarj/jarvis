-- Deployed --check proved postgres has private-schema USAGE but lacks EXECUTE
-- on this guard-owned helper. Migration 006 granted it before ownership was
-- transferred; PostgreSQL transfers old-owner privileges to the new owner.
-- Grant after the ownership transfer, acting as the existing function owner.
-- No role membership, schema CREATE, Auth access, RLS or web privilege changes.
set local role jarvis_auth_guard;
grant execute on function private.m2c_channel_test_v1(uuid) to postgres;
reset role;
