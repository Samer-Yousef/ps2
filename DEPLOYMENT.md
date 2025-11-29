# Deployment Guide - VPS Production Setup

This guide covers all the steps and configuration changes needed to deploy this Next.js pathology search app to a VPS.

## Table of Contents
1. [Prerequisites](#prerequisites)
2. [Environment Variables](#environment-variables)
3. [Database Setup](#database-setup)
4. [Reverse Proxy Configuration](#reverse-proxy-configuration)
5. [SSL/HTTPS Setup](#sslhttps-setup)
6. [OAuth Configuration](#oauth-configuration)
7. [Next.js Build & Deployment](#nextjs-build--deployment)
8. [Common Issues & Troubleshooting](#common-issues--troubleshooting)

---

## Prerequisites

### Required Software on VPS:
- **Node.js** (v18 or higher): `curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs`
- **npm** or **pnpm**: Included with Node.js
- **Git**: `sudo apt install git`
- **Reverse Proxy**: Choose one:
  - **Caddy** (recommended - automatic HTTPS): `sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https && curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg && curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list && sudo apt update && sudo apt install caddy`
  - **nginx**: `sudo apt install nginx certbot python3-certbot-nginx`
- **Process Manager**: `npm install -g pm2`

### Domain Setup:
- Domain name pointing to your VPS IP address
- DNS A record: `yourdomain.com` → `VPS_IP_ADDRESS`
- Wait for DNS propagation (can take up to 24 hours, usually much faster)

---

## Environment Variables

### Development (.env) - Current Setup:
```env
DATABASE_URL="file:./prisma/dev.db"
NEXTAUTH_SECRET="your-secret-key-change-this-in-production"
NEXTAUTH_URL="http://localhost:3002"

# If adding Google OAuth:
# GOOGLE_CLIENT_ID="your-dev-client-id"
# GOOGLE_CLIENT_SECRET="your-dev-client-secret"
```

### Production (.env on VPS) - Required Changes:
```env
# Database - Change to absolute path on VPS
DATABASE_URL="file:/home/youruser/app/prisma/production.db"

# NextAuth - CRITICAL: Generate new secret for production
NEXTAUTH_SECRET="GENERATE_A_NEW_LONG_RANDOM_STRING_HERE"
NEXTAUTH_URL="https://yourdomain.com"

# Google OAuth (if implemented)
GOOGLE_CLIENT_ID="your-production-client-id"
GOOGLE_CLIENT_SECRET="your-production-client-secret"

# Node environment
NODE_ENV="production"
```

### Generate Production Secret:
```bash
# Run this command to generate a secure secret:
openssl rand -base64 32
```

**⚠️ CRITICAL:** Never commit production `.env` file to Git! It should only exist on the VPS.

---

## Database Setup

### Current Database (SQLite):
- Development uses: `./prisma/dev.db`
- Simple file-based database

### Production Database Options:

#### Option 1: SQLite (Easiest - Current Setup)
**Pros:** No additional services needed, simple backup
**Cons:** Not suitable for high traffic, single-file locking

```bash
# On VPS - Create database directory
mkdir -p /home/youruser/app/prisma

# Set proper permissions
chmod 755 /home/youruser/app/prisma

# Database will be created automatically on first migration
```

**Backup Strategy:**
```bash
# Add to cron job - backup daily
0 2 * * * cp /home/youruser/app/prisma/production.db /home/youruser/backups/db-$(date +\%Y\%m\%d).db
```

#### Option 2: PostgreSQL (Recommended for Production)
**Pros:** Better performance, concurrent connections, production-ready
**Cons:** More setup required

```bash
# Install PostgreSQL
sudo apt install postgresql postgresql-contrib

# Create database and user
sudo -u postgres psql
CREATE DATABASE pathology_search;
CREATE USER pathology_user WITH ENCRYPTED PASSWORD 'secure_password_here';
GRANT ALL PRIVILEGES ON DATABASE pathology_search TO pathology_user;
\q
```

**Update Prisma Schema:**
```prisma
datasource db {
  provider = "postgresql"  // Change from "sqlite"
  url      = env("DATABASE_URL")
}
```

**Update .env:**
```env
DATABASE_URL="postgresql://pathology_user:secure_password_here@localhost:5432/pathology_search"
```

**Update prisma.ts:**
```typescript
// Remove LibSQL adapter, use native PostgreSQL
import { PrismaClient } from '@prisma/client'

export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
})
```

---

## Reverse Proxy Configuration

### Option 1: Caddy (Easiest - Automatic HTTPS)

Create `/etc/caddy/Caddyfile`:
```
yourdomain.com {
    reverse_proxy localhost:3000

    # Optional: Enable compression
    encode gzip

    # Optional: Custom headers
    header {
        # Security headers
        Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
        X-Frame-Options "SAMEORIGIN"
        X-Content-Type-Options "nosniff"
        Referrer-Policy "strict-origin-when-cross-origin"
    }
}
```

Start Caddy:
```bash
sudo systemctl enable caddy
sudo systemctl start caddy
```

**That's it!** Caddy automatically handles SSL certificates via Let's Encrypt.

### Option 2: nginx (More Manual Setup)

Create `/etc/nginx/sites-available/pathology-search`:
```nginx
server {
    listen 80;
    server_name yourdomain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Enable site:
```bash
sudo ln -s /etc/nginx/sites-available/pathology-search /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

Get SSL certificate:
```bash
sudo certbot --nginx -d yourdomain.com
```

---

## SSL/HTTPS Setup

### Using Caddy:
- Automatic - no manual steps needed!

### Using nginx + Certbot:
```bash
# Install Certbot
sudo apt install certbot python3-certbot-nginx

# Get certificate (follow prompts)
sudo certbot --nginx -d yourdomain.com

# Auto-renewal (should be automatic, verify with:)
sudo certbot renew --dry-run
```

### Verify HTTPS:
1. Visit `https://yourdomain.com` (should redirect from http automatically)
2. Check for padlock icon in browser
3. Test at: https://www.ssllabs.com/ssltest/

---

## OAuth Configuration

### Google OAuth - Add Production URLs

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Navigate to: APIs & Services → Credentials
3. Find your OAuth 2.0 Client ID
4. Add to **Authorized redirect URIs**:
   - Keep: `http://localhost:3002/api/auth/callback/google`
   - Add: `https://yourdomain.com/api/auth/callback/google`

### Update .env on VPS:
```env
NEXTAUTH_URL="https://yourdomain.com"
GOOGLE_CLIENT_ID="your-client-id"
GOOGLE_CLIENT_SECRET="your-client-secret"
```

**Note:** You can use the same Google OAuth credentials for both dev and production!

---

## Next.js Build & Deployment

### Initial Deployment:

```bash
# 1. Clone repository to VPS
cd /home/youruser
git clone your-repo-url app
cd app

# 2. Install dependencies
npm install

# 3. Set up environment variables
nano .env  # Paste production config

# 4. Generate Prisma client
npx prisma generate

# 5. Run database migrations
npx prisma migrate deploy

# 6. Build Next.js app
npm run build

# 7. Start with PM2 (process manager)
pm2 start npm --name "pathology-search" -- start
pm2 save
pm2 startup  # Follow the command it outputs
```

### Deployment Checklist:
- [ ] Environment variables configured
- [ ] Database migrated
- [ ] Next.js built successfully
- [ ] PM2 running the app
- [ ] Reverse proxy configured
- [ ] HTTPS working
- [ ] OAuth redirect URLs updated
- [ ] Test registration/login
- [ ] Test search functionality
- [ ] Check error logs: `pm2 logs pathology-search`

### Update Deployment (After Code Changes):

```bash
# On VPS
cd /home/youruser/app

# Pull latest changes
git pull origin main

# Install any new dependencies
npm install

# Regenerate Prisma client if schema changed
npx prisma generate

# Run any new migrations
npx prisma migrate deploy

# Rebuild Next.js
npm run build

# Restart app
pm2 restart pathology-search
```

---

## Common Issues & Troubleshooting

### 1. Port Already in Use
**Error:** `Port 3000 is already in use`

**Solution:**
```bash
# Find process using port 3000
sudo lsof -i :3000

# Kill process
sudo kill -9 PID

# Or change Next.js port in package.json:
"scripts": {
  "start": "next start -p 3001"
}
```

### 2. Database Connection Errors
**Error:** `Can't reach database server` or `ENOENT: no such file or directory`

**SQLite Solution:**
```bash
# Check database path exists
ls -la /home/youruser/app/prisma/

# Ensure correct permissions
chmod 755 /home/youruser/app/prisma
chmod 644 /home/youruser/app/prisma/production.db

# Verify DATABASE_URL in .env
cat .env | grep DATABASE_URL
```

**PostgreSQL Solution:**
```bash
# Test connection
psql -h localhost -U pathology_user -d pathology_search

# Check if PostgreSQL is running
sudo systemctl status postgresql
```

### 3. NextAuth Session Issues
**Error:** `Session undefined` or constant login prompts

**Solutions:**
- Verify `NEXTAUTH_URL` matches your domain exactly
- Check `NEXTAUTH_SECRET` is set and not default value
- Ensure cookies work over HTTPS
- Check browser console for cookie errors
- Verify middleware matcher doesn't block auth routes

```bash
# Verify environment variables are loaded
pm2 env pathology-search
```

### 4. Prisma Client Out of Sync
**Error:** `Prisma Client did not initialize yet` or `Unknown field`

**Solution:**
```bash
# Regenerate Prisma client
npx prisma generate

# Rebuild app
npm run build

# Restart
pm2 restart pathology-search
```

### 5. OAuth Redirect Mismatch
**Error:** `redirect_uri_mismatch` from Google

**Solution:**
- Ensure Google Cloud Console has exact redirect URL
- Format: `https://yourdomain.com/api/auth/callback/google` (no trailing slash)
- Wait 5 minutes after adding URL for Google to update
- Clear browser cookies and try again

### 6. 502 Bad Gateway (nginx)
**Error:** `502 Bad Gateway`

**Causes & Solutions:**
```bash
# Next.js not running - check PM2
pm2 status
pm2 restart pathology-search

# Wrong port in nginx config
# Verify nginx reverse_proxy points to correct port (3000 or 3001)
sudo nano /etc/nginx/sites-available/pathology-search

# Test nginx config
sudo nginx -t

# Restart nginx
sudo systemctl restart nginx
```

### 7. Module Not Found Errors
**Error:** `Cannot find module 'xyz'`

**Solution:**
```bash
# Clean install dependencies
rm -rf node_modules package-lock.json
npm install

# Regenerate Prisma client
npx prisma generate

# Rebuild
npm run build

# Restart
pm2 restart pathology-search
```

### 8. Out of Memory (OOM)
**Error:** `JavaScript heap out of memory`

**Solution:**
```bash
# Increase Node.js memory limit in PM2
pm2 delete pathology-search
pm2 start npm --name "pathology-search" --node-args="--max-old-space-size=4096" -- start

# Or in package.json:
"scripts": {
  "start": "NODE_OPTIONS='--max-old-space-size=4096' next start"
}
```

### 9. Slow Search Performance
**Causes:**
- Large dataset not optimized
- Missing database indexes
- SQLite limitations

**Solutions:**
```bash
# Add indexes to Prisma schema:
# In schema.prisma, add:
@@index([caseId])
@@index([userId, viewedAt])

# Run migration
npx prisma migrate dev --name add_indexes

# Consider switching to PostgreSQL for better performance
```

### 10. File Permission Errors
**Error:** `EACCES: permission denied`

**Solution:**
```bash
# Fix ownership
sudo chown -R youruser:youruser /home/youruser/app

# Fix permissions
chmod -R 755 /home/youruser/app
chmod 644 /home/youruser/app/.env
```

---

## Monitoring & Logs

### PM2 Commands:
```bash
# View logs
pm2 logs pathology-search

# Monitor resources
pm2 monit

# Restart app
pm2 restart pathology-search

# Stop app
pm2 stop pathology-search

# View status
pm2 status

# Save current PM2 list
pm2 save
```

### Check Server Logs:
```bash
# Next.js errors
pm2 logs pathology-search --err

# nginx logs
sudo tail -f /var/log/nginx/error.log
sudo tail -f /var/log/nginx/access.log

# Caddy logs
sudo journalctl -u caddy --follow
```

---

## Performance Optimization

### Enable Compression (if not using Caddy):
In `next.config.ts`:
```typescript
const nextConfig: NextConfig = {
  compress: true,
  // ... rest of config
}
```

### Static Asset Caching (nginx):
```nginx
location /_next/static/ {
    proxy_pass http://localhost:3000;
    proxy_cache_valid 200 60m;
    expires 1y;
    add_header Cache-Control "public, immutable";
}
```

### Database Optimization:
```bash
# SQLite - Regular cleanup
sqlite3 production.db "VACUUM;"

# Add indexes for common queries
# See schema.prisma and add @@index() directives
```

---

## Security Checklist

- [ ] Strong `NEXTAUTH_SECRET` (32+ random characters)
- [ ] HTTPS enabled (SSL certificate valid)
- [ ] Security headers configured in reverse proxy
- [ ] Database not exposed to internet
- [ ] `.env` file not in version control
- [ ] Regular backups configured
- [ ] Firewall configured (allow only 80, 443, 22)
- [ ] SSH key-based authentication (disable password auth)
- [ ] Regular system updates: `sudo apt update && sudo apt upgrade`

---

## Backup Strategy

### Automated Database Backup:
```bash
# Create backup script
nano /home/youruser/backup.sh
```

```bash
#!/bin/bash
BACKUP_DIR="/home/youruser/backups"
DB_PATH="/home/youruser/app/prisma/production.db"
DATE=$(date +%Y%m%d_%H%M%S)

mkdir -p $BACKUP_DIR
cp $DB_PATH "$BACKUP_DIR/db_$DATE.db"

# Keep only last 30 days
find $BACKUP_DIR -name "db_*.db" -mtime +30 -delete

echo "Backup completed: db_$DATE.db"
```

```bash
# Make executable
chmod +x /home/youruser/backup.sh

# Add to crontab (daily at 2 AM)
crontab -e
# Add line:
0 2 * * * /home/youruser/backup.sh >> /home/youruser/backup.log 2>&1
```

---

## Quick Reference

### VPS Setup Summary:
1. Install Node.js, Git, Caddy/nginx
2. Clone repository
3. Configure `.env` with production values
4. Install dependencies: `npm install`
5. Generate Prisma client: `npx prisma generate`
6. Run migrations: `npx prisma migrate deploy`
7. Build app: `npm run build`
8. Start with PM2: `pm2 start npm --name "pathology-search" -- start`
9. Configure reverse proxy (Caddy/nginx)
10. Set up HTTPS (automatic with Caddy, or use Certbot)
11. Update OAuth redirect URLs
12. Test everything!

### Important File Locations:
- App: `/home/youruser/app`
- Database: `/home/youruser/app/prisma/production.db`
- Backups: `/home/youruser/backups`
- Caddy config: `/etc/caddy/Caddyfile`
- nginx config: `/etc/nginx/sites-available/pathology-search`

---

## Need Help?

- Next.js docs: https://nextjs.org/docs
- Prisma docs: https://www.prisma.io/docs
- NextAuth docs: https://next-auth.js.org
- PM2 docs: https://pm2.keymetrics.io/docs
- Caddy docs: https://caddyserver.com/docs
