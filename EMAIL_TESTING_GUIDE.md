# Email Report Testing Guide

## Overview
The WashGrid dashboard now has **per-site email configuration**. Each site can have independent automated report delivery settings.

---

## Admin Page Changes

### ✅ What Changed
- **REMOVED**: Global email subscription clutter
- **KEPT**: Per-site email configuration in each SiteAdminCard

### Admin Page Structure
```
Sites Section
├── Eurocar Jetpark Card
│   ├── Meters & Sensors
│   ├── Security Keys (Device Keys)
│   └── ✨ Automated Site Reports (Per-Site Email Config)
├── Another Site Card
│   └── ✨ Automated Site Reports
└── More Sites...
```

---

## Per-Site Email Configuration

### Location
**Admin Page** → Scroll down → **Each Site Card** → **"Automated Site Reports"** section

### Settings Available

#### 1. **Scheduled Send Time**
- **What**: Hour of day to send reports (0-23 format)
- **Example**: Select "07" → Reports send at 7:00 AM site time
- **Uses Site Timezone**: The time is adjusted to the site's local timezone

#### 2. **Site Timezone**
- **What**: Timezone where the site is located
- **Example**: `Africa/Johannesburg`, `America/New_York`, `UTC`
- **Why**: Ensures reports send at the correct local time

#### 3. **Delivery Recipients**
- **What**: Email addresses to receive reports
- **Format**: Comma-separated list
- **Example**: `manager@washsite.com, ops@washsite.com, owner@washsite.com`
- **Validation**: System checks for valid email format

#### 4. **Daily Intelligence Toggle**
- **What**: Enable/disable daily reports
- **When**: Sends every day at the scheduled time
- **Contains**: Hourly breakdown CSV with all meter readings for that day

#### 5. **Monthly CSV Analytics Toggle**
- **What**: Enable/disable monthly reports
- **When**: Sends on the 1st of every month
- **Contains**: Daily breakdown CSV with all readings for the previous month

### Buttons

#### **Instant Test** 🧪
- **Purpose**: Send a test report immediately
- **Use**: Verify configuration works before enabling automation
- **Recipients**: Same as configured recipients list
- **Report**: Uses current period (today for daily, this month for monthly)
- **Action**: Click → Report generates and sends → Check your email

#### **Save Schedule** 💾
- **Purpose**: Save all configuration changes
- **Required**: Must click to apply any changes
- **Feedback**: Toast notification on success/error
- **Database**: Updates the `sites` table with new settings

---

## How to Set Up Email Reporting

### Step 1: Configure Per-Site Settings
1. **Go to**: Admin Page
2. **Find**: Eurocar Jetpark card (or your site)
3. **Scroll to**: "Automated Site Reports" section
4. **Enter**:
   - Send Time: `07` (for 7:00 AM)
   - Timezone: `Africa/Johannesburg` (or your site's timezone)
   - Recipients: `your-email@example.com`
5. **Enable**: Toggle "Daily Intelligence" ON
6. **Click**: "Save Schedule" button
7. **Check**: Green toast notification "Automated report settings saved"

### Step 2: Test the Email
1. **Click**: "Instant Test" button
2. **Wait**: 2-5 seconds for email to send
3. **Check**: Your email inbox (and spam folder)
4. **Verify**: Email subject says `Daily report — Eurocar Jetpark — YYYY-MM-DD`
5. **Attachment**: CSV file with hourly data

### Step 3: Automate (Scheduled Sending)
- **Automatic**: Once configured, reports send daily at the scheduled time
- **Timezone-Aware**: System adjusts to site timezone
- **Deduplication**: Won't send twice on same day even if server restarts
- **Schedule**: Runs every hour on the hour via Cloudflare Cron

---

## Testing Checklist

### ✅ Basic Configuration Test
- [ ] Navigate to admin page
- [ ] Find site card
- [ ] Find "Automated Site Reports" section
- [ ] All fields are present (time, timezone, recipients, toggles)
- [ ] Can edit values
- [ ] "Save Schedule" button works
- [ ] Toast notification appears

### ✅ Email Sending Test
- [ ] Enter valid email address(es) in Recipients
- [ ] Click "Instant Test" button
- [ ] Email arrives in inbox within 2-5 seconds
- [ ] Email subject is correct: `Daily report — [Site Name] — YYYY-MM-DD`
- [ ] CSV attachment is present
- [ ] CSV contains hourly data
- [ ] Can open/download attachment

### ✅ Multiple Recipients Test
- [ ] Recipients: `user1@example.com, user2@example.com`
- [ ] Click "Instant Test"
- [ ] Both users receive the email
- [ ] Email received at same time

### ✅ Timezone Test
- [ ] Set timezone: `Africa/Johannesburg`
- [ ] Set send time: `07`
- [ ] Configure another site with `America/New_York` timezone
- [ ] Reports respect each timezone
- [ ] Verify logs show correct send times

### ✅ Enable/Disable Test
- [ ] Toggle Daily Intelligence ON
- [ ] Toggle Monthly Analytics ON
- [ ] Save Schedule
- [ ] Click Instant Test
- [ ] Receive 2 emails (one daily, one monthly)
- [ ] Toggle one OFF
- [ ] Click Instant Test
- [ ] Receive only 1 email

### ✅ Scheduled Sending Test (Production)
- [ ] Configure site with send time = current hour + 1
- [ ] Wait for that hour (should send automatically)
- [ ] Check email inbox
- [ ] Report arrived at scheduled time

---

## What to Check in Database

### Table: `report_send_log`
```sql
SELECT * FROM public.report_send_log 
ORDER BY sent_at DESC 
LIMIT 10;
```

**Shows**:
- `site_id`: Which site sent report
- `report_type`: 'daily' or 'monthly'
- `period_key`: Date/month of report (YYYY-MM-DD or YYYY-MM)
- `recipients`: Email addresses that received it
- `sent_at`: When it was sent
- `status`: 'sent' or 'failed'

### Table: `sites`
```sql
SELECT id, name, report_hour, timezone, report_recipients, daily_report_enabled, monthly_report_enabled 
FROM public.sites;
```

**Shows**:
- `report_hour`: Hour of day (0-23)
- `timezone`: Site timezone string
- `report_recipients`: Array of emails
- `daily_report_enabled`: TRUE/FALSE
- `monthly_report_enabled`: TRUE/FALSE

---

## Common Issues & Solutions

### ❌ "Instant Test" Button Does Nothing
**Problem**: Button doesn't show loading state
**Solution**: 
- Check browser console for errors (F12)
- Verify SENDGRID_API_KEY is set in Cloudflare secrets
- Try manual POST: `curl -X POST https://auto.washdashboard.workers.dev/api/public/hooks/send-reports?force=SITE_ID`

### ❌ Email Not Received
**Problem**: Test button clicked but no email arrives
**Solutions**:
1. Check spam/junk folder
2. Verify email address is valid (has @ and .)
3. Check database: `report_send_log` table for failures
4. Verify SendGrid API key in Cloudflare Workers secrets
5. Check Cloudflare Workers logs: `wrangler tail`

### ❌ "Invalid Email Address" Error
**Problem**: Toast shows validation error
**Solution**:
- Format: `user@domain.com` (must have @ and .)
- Remove spaces around commas
- Correct: `a@b.com, c@d.com`
- Wrong: `a@b .com` or `a@b.com,` (trailing comma)

### ❌ Email Has No Attachment
**Problem**: Email arrives but CSV is missing
**Solution**:
- Check site has meters configured
- Verify readable data exists (at least one reading)
- Check system time is correct
- Look at SQL logs for errors in report generation

### ❌ Email Sends at Wrong Time
**Problem**: Email arrives at unexpected time
**Solution**:
- Verify timezone in config matches site location
- Remember: Time is in site local time, not UTC
- Cron job runs hourly, so might send a bit after the exact hour
- Check `report_send_log.sent_at` field for exact send time

---

## Production Email Setup

### Required Environment Variables (Cloudflare)
```
SENDGRID_API_KEY=sg_xxxxxxxxxxxx
```

### How to Set in Cloudflare Workers
1. Go to **Cloudflare Dashboard**
2. **Workers** → Your site
3. **Settings** → **Variables & Secrets**
4. **Add Encrypted Secret**:
   - Name: `SENDGRID_API_KEY`
   - Value: Your SendGrid API key
5. Deploy

### Getting SendGrid API Key
1. **Sign up**: https://sendgrid.com
2. **Go to**: Settings → API Keys
3. **Create**: Full Access API Key
4. **Copy**: The long key
5. **Store**: In Cloudflare secrets

### Monitor Email Sending
1. **Cloudflare Workers**: View tail logs
   ```bash
   npx wrangler tail
   ```
2. **SendGrid Dashboard**: View activity log
3. **Database**: Query `report_send_log` table

---

## How It Works (Technical)

### Automated Flow
```
1. Cloudflare Cron (every hour)
   ↓
2. POST /api/public/hooks/send-reports
   ↓
3. Query all active sites
   ↓
4. For each site:
   - Check if current hour matches report_hour
   - Check if recipients list is valid
   - Generate CSV report
   - Send via SendGrid
   - Log result in report_send_log
   ↓
5. Return JSON with results
```

### Manual Test Flow
```
1. Click "Instant Test" button
   ↓
2. POST /api/public/hooks/send-reports?force=SITE_ID
   ↓
3. Force send regardless of hour
   ↓
4. Generate report
   ↓
5. Send to recipients
   ↓
6. Log to report_send_log
   ↓
7. Show success toast
```

---

## Report Format

### Daily Report
**Filename**: `sitename_daily_YYYY-MM-DD.csv`
**Contents**: Hourly breakdown
```
hour,Wash Meter (washes),Water Meter (L)
00:00,0,0
01:00,5,150
02:00,12,360
...
23:00,8,240
```

### Monthly Report
**Filename**: `sitename_monthly_YYYY-MM.csv`
**Contents**: Daily breakdown
```
date,Wash Meter (washes),Water Meter (L)
2026-07-01,45,1350
2026-07-02,52,1560
...
2026-07-31,48,1440
```

---

## Next Steps

1. **Redeploy** commit `f684733`
2. **Go to Admin** page
3. **Find site card**
4. **Scroll to** "Automated Site Reports"
5. **Configure** email settings
6. **Click** "Instant Test"
7. **Check email**
8. **Click** "Save Schedule"
9. **Reports auto-send** at scheduled time

---

## Support

**Check these when troubleshooting**:
- [ ] Is the feature visible on admin page?
- [ ] Can you save settings (toast notification)?
- [ ] Do test emails arrive?
- [ ] Check `report_send_log` table for send history
- [ ] Check `sites` table for saved configuration
- [ ] Look at Cloudflare Workers logs: `wrangler tail`

