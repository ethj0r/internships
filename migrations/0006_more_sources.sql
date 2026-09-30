-- More boards for the big-tech and Southeast Asia focus (checked 2026-09-28: each returned a live board).
-- Big tech career sites without a public feed (Google, Amazon, Microsoft, Meta, Apple, TikTok/ByteDance, Shopee)
-- aren't crawled; they're on the watchlist (config/watchlist.json) for import by URL.
INSERT INTO sources (kind, identifier, name) VALUES
  ('ashby', 'airwallex', 'Airwallex'),
  ('ashby', 'openai', 'OpenAI'),
  ('ashby', 'snowflake', 'Snowflake'),
  ('lever', 'ninjavan', 'Ninja Van'),
  ('lever', 'nium', 'Nium'),
  ('lever', 'binance', 'Binance'),
  ('greenhouse', 'okta', 'Okta'),
  ('greenhouse', 'twilio', 'Twilio'),
  ('greenhouse', 'flip', 'Flip')
ON CONFLICT (kind, identifier) DO NOTHING;

