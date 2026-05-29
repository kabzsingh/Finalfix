CREATE TABLE IF NOT EXISTS smtp_settings (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE,
  host TEXT NOT NULL,
  port INTEGER NOT NULL DEFAULT 587,
  user_email TEXT NOT NULL,
  password TEXT NOT NULL,
  from_name TEXT NOT NULL,
  from_email TEXT NOT NULL,
  encryption TEXT NOT NULL DEFAULT 'tls', -- 'tls', 'ssl', or 'none'
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT one_row CHECK (id = TRUE)
);

-- Enable RLS
ALTER TABLE smtp_settings ENABLE ROW LEVEL SECURITY;

-- Only admins can manage SMTP settings
CREATE POLICY "Admins can manage SMTP settings"
  ON smtp_settings
  FOR ALL
  TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'admin'));
