GRANT USAGE ON SCHEMA identity TO sifer_identity;

GRANT SELECT, INSERT, UPDATE
  ON identity.user_account,
     identity.external_identity,
     identity.third_party_grant,
     identity.refresh_token
  TO sifer_identity;
