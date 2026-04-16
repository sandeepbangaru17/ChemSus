# ChemSus — Deployment Guide

> **Server:** Ubuntu 24.04 LTS · IP `104.168.54.192`  
> **Domain:** `19062002.xyz` (managed via Cloudflare)  
> **Project:** `/home/pavankumar/ChemSus` · Port `5656`  
> **Tools already installed:** Nginx 1.24 · PM2 6 · Certbot 2.9 · Node.js 20

---

## Your Live URLs (once deployed)

| | URL |
|---|---|
| **Customer site** | `https://19062002.xyz` |
| **Admin login** | `https://19062002.xyz/admin/login.html` |
| **Admin dashboard** | `https://19062002.xyz/admin/admin.html` |

---

## Step 1 — Cloudflare DNS setup

Log in to [dash.cloudflare.com](https://dash.cloudflare.com) → select `19062002.xyz` → **DNS** tab.

Add one record:

| Type | Name | IPv4 address | Proxy status |
|------|------|--------------|--------------|
| A | `@` | `104.168.54.192` | **DNS only** (grey cloud) |

> ⚠️ **Keep proxy OFF (grey cloud).** Cloudflare's orange-cloud proxy blocks Certbot's SSL verification in Step 4. You can turn it back on after getting the certificate.

Check propagation (takes 1–5 minutes with Cloudflare):
```bash
dig +short 19062002.xyz
# Should return: 104.168.54.192
```

---

## Step 2 — Install production dependencies

```bash
cd /home/pavankumar/ChemSus
npm install --omit=dev
```

---

## Step 3 — Start the app with PM2

```bash
cd /home/pavankumar/ChemSus

# Start the app
pm2 start backend/server.js --name chemsus --cwd /home/pavankumar/ChemSus

# Verify it's running (should show "online")
pm2 status

# Check logs — should show: ✅ SQLite ready + Server running on port 5656
pm2 logs chemsus --lines 20

# Save so it survives reboots
pm2 save

# Enable auto-start on boot — copy and run the command it prints
pm2 startup
```

---

## Step 4 — Set up Nginx

The config file is already prepared at `/home/pavankumar/ChemSus/nginx-chemsus.conf`.

```bash
# Copy into Nginx
sudo cp /home/pavankumar/ChemSus/nginx-chemsus.conf /etc/nginx/sites-available/chemsus

# Enable the site
sudo ln -s /etc/nginx/sites-available/chemsus /etc/nginx/sites-enabled/chemsus

# Test — must say "syntax is ok"
sudo nginx -t

# Reload
sudo systemctl reload nginx
```

---

## Step 5 — Get a free SSL certificate

> Run this only after DNS is propagated (`dig +short 19062002.xyz` returns `104.168.54.192`).

```bash
sudo certbot --nginx -d 19062002.xyz
```

When prompted:
1. Enter your email address
2. Agree to terms → `Y`
3. Choose redirect option → `2`

Certbot will automatically update the Nginx config with SSL paths.

**Test auto-renewal:**
```bash
sudo certbot renew --dry-run
# Should say: all simulated renewals succeeded
```

---

## Step 6 — Final verification

```bash
pm2 status                          # chemsus = online
sudo systemctl status nginx         # active (running)
ss -tlnp | grep 5656                # port listening
curl https://19062002.xyz/api/test  # {"ok":true,...}
```

Open in browser:
- `https://19062002.xyz` → homepage loads
- `https://19062002.xyz/shop.html` → products load
- `https://19062002.xyz/admin/login.html` → login works
- `https://19062002.xyz/admin/admin.html` → dashboard works

---

## Optional: Turn Cloudflare proxy back ON

After SSL is issued, go to Cloudflare → DNS → click the grey cloud on the A record to turn it orange.

Then go to Cloudflare → **SSL/TLS** → set mode to **Full (strict)**.

---

## Firewall — open required ports

```bash
sudo ufw allow 22    # SSH
sudo ufw allow 80    # HTTP → redirects to HTTPS
sudo ufw allow 443   # HTTPS
sudo ufw enable
sudo ufw status
```

> Port 5656 stays private — Nginx proxies to it internally.

---

## Day-to-day operations

```bash
# Restart after code changes
cd /home/pavankumar/ChemSus && pm2 restart chemsus

# View live logs
pm2 logs chemsus

# Backup the database
cp db/chemsus.sqlite db/chemsus_backup_$(date +%Y%m%d_%H%M).sqlite

# Check Nginx errors
sudo tail -f /var/log/nginx/error.log
```

---

## Deployment checklist

- [ ] Cloudflare A record `@` → `104.168.54.192` (grey cloud / DNS only)
- [ ] `dig +short 19062002.xyz` returns `104.168.54.192`
- [ ] `npm install --omit=dev` completed
- [ ] `pm2 start backend/server.js --name chemsus` → status **online**
- [ ] `pm2 save` and `pm2 startup` done
- [ ] Nginx config copied, enabled, `sudo nginx -t` passes
- [ ] `sudo certbot --nginx -d 19062002.xyz` succeeded
- [ ] `https://19062002.xyz` loads
- [ ] `https://19062002.xyz/admin/login.html` login works
- [ ] OTP email arrives when testing checkout
