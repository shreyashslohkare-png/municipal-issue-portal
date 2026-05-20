# Municipal Issue Portal

A privacy-first municipal complaint website with a no-dependency Node.js backend and a responsive frontend.

## What It Does

- Citizens upload a complaint photo, category, description, address, and optional browser geolocation.
- Public tracker shows issue status without exposing reporter identity.
- Municipal office dashboard uses an admin PIN to view private contact details.
- Officers can assign workers, verify issues, mark work in progress, and complete work with proof photo.
- Data is stored locally in `data/complaints.json`.

## Run It

```powershell
npm start
```

Open:

```text
http://localhost:3000
```

Demo municipal office PIN:

```text
2468
```

You can change the PIN:

```powershell
$env:ADMIN_PIN="your-secure-pin"; npm start
```

## Put It Online

This app needs Node hosting because it has a backend. Static hosts such as GitHub Pages are not enough.

Recommended simple route:

1. Create a GitHub repository and upload this project.
2. Go to Render and create a new Web Service from that repository.
3. Use:
   - Build command: `npm install`
   - Start command: `npm start`
4. Add environment variables:
   - `ADMIN_PIN`: choose your private municipal office PIN
   - `DATA_DIR`: `/var/data`
5. Add a persistent disk mounted at `/var/data`.
6. Deploy. Render will give you a public `onrender.com` URL.

The included `render.yaml` can also be used as a Render Blueprint.

## Production Notes

This is a complete working MVP. Before a real municipality uses it, add:

- Real user accounts and role-based permissions.
- Cloud object storage for photos.
- Database such as PostgreSQL.
- HTTPS, audit logs, and rate limiting.
- Moderation workflow for public complaints.
- SMS/email notifications for citizens and workers.
