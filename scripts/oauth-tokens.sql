create table if not exists oauth_tokens (
  id serial primary key,
  provider varchar(50) not null,
  access_token text not null,
  refresh_token text,
  expires_at timestamp,
  created_at timestamp default now(),
  updated_at timestamp default now()
);

create index if not exists oauth_tokens_provider_idx on oauth_tokens(provider);
