-- Run in SQL Editor AFTER you sign up on jeupolkxhwzojsvzfqqv (Authentication → Users must show your email).
-- Replace the email below, then Run.

INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'::public.app_role
FROM auth.users
WHERE email = 'YOUR_EMAIL@example.com'
ON CONFLICT (user_id, role) DO NOTHING;
