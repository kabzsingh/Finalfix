-- Create email_subscriptions table
CREATE TABLE IF NOT EXISTS email_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  period VARCHAR(20) NOT NULL CHECK (period IN ('daily', 'monthly')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_sent_at TIMESTAMP WITH TIME ZONE
);

-- Create indexes
CREATE INDEX idx_email_subscriptions_site ON email_subscriptions(site_id);
CREATE INDEX idx_email_subscriptions_active ON email_subscriptions(active);
CREATE INDEX idx_email_subscriptions_period ON email_subscriptions(period);

-- Enable RLS
ALTER TABLE email_subscriptions ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- Users can view their own subscriptions (if user_id is set)
CREATE POLICY "Users can view their own subscriptions"
  ON email_subscriptions
  FOR SELECT
  USING (auth.uid() = user_id OR user_id IS NULL);

-- Users can create subscriptions
CREATE POLICY "Users can create subscriptions"
  ON email_subscriptions
  FOR INSERT
  WITH CHECK (auth.uid() = user_id OR user_id IS NULL);

-- Users can update their own subscriptions
CREATE POLICY "Users can update their own subscriptions"
  ON email_subscriptions
  FOR UPDATE
  USING (auth.uid() = user_id OR user_id IS NULL)
  WITH CHECK (auth.uid() = user_id OR user_id IS NULL);

-- Users can delete their own subscriptions
CREATE POLICY "Users can delete their own subscriptions"
  ON email_subscriptions
  FOR DELETE
  USING (auth.uid() = user_id OR user_id IS NULL);

-- Allow public (service) access to fetch active subscriptions for sending
CREATE POLICY "Public can fetch active subscriptions for sending"
  ON email_subscriptions
  FOR SELECT
  USING (active = true);
