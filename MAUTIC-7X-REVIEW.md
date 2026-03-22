# Mautic 7.x ("Columba Edition") — Branch Review

**Review Date:** 2026-03-22
**Branch:** [mautic/mautic@7.x](https://github.com/mautic/mautic/tree/7.x)
**Release:** Mautic 7.0 — released January 20, 2026

---

## 1. Overview

Mautic is an open-source marketing automation platform. Version 7.0 ("Columba Edition") is a major release that modernizes the codebase, removes legacy code, and introduces new campaign management features. It follows a new Long Term Support (LTS) release strategy with a 4-year support cycle.

---

## 2. Key Technology Stack

| Component         | Version / Requirement          |
|--------------------|-------------------------------|
| PHP               | 8.2+ (supports up to 8.4)     |
| Symfony           | 7.3                           |
| MySQL             | 8.4.0+                        |
| MariaDB           | 10.11.0+                      |
| Templating        | Twig                          |
| Testing           | Codeception                   |
| Code Analysis     | PHPStan, Rector               |
| Frontend Build    | Webpack, npm                  |

---

## 3. Major Changes in 7.x

### 3.1 Campaign & Resource Management
- Group related resources (emails, landing pages, forms, assets) under a single project structure.
- Full campaign import/export with related assets between environments.

### 3.2 Segmented Email Improvements
- Dynamic segment emails that adapt to audience growth in real-time.
- Option to lock audience at send time for precise targeting.

### 3.3 Audit Logging
- New audit log tab for campaigns showing changes, authors, and timestamps.

### 3.4 Performance & UX
- Optimized dashboard queries and faster campaign execution.
- Improved bounce recognition for Outlook and Exchange.
- Mobile notification preview enhancements.
- Better UX for scheduled email sending.

### 3.5 Code Modernization
- Removal of vast amounts of legacy code for a cleaner core.
- Updated outdated dependencies for security and modern practices.
- Codebase made easier to extend and maintain.

### 3.6 New Features
- Date token for campaign actions combined with text fields.
- PHP 8.4 support added; PHP 8.1 support dropped.

---

## 4. Support Cycle

| Period              | Duration |
|---------------------|----------|
| Active Support      | 1 year   |
| Security Support    | 1 year   |
| Extended LTS (ELTS) | 2 years  |
| **Total**           | **4 years** |

---

## 5. Repository Statistics

- **Total Commits:** ~35,437
- **Open Issues:** ~53
- **Open Pull Requests:** ~220
- **Contributors:** 100+
- **Latest Commit:** `8e323de1289d107106c27254a9f4bdc0ce78376c`

---

## 6. Project Structure

```
mautic/
├── app/           # Core application logic
├── plugins/       # Extension/plugin system
├── themes/        # UI themes and customization
├── templates/     # Twig templates
├── tests/         # Codeception test suites
├── config/        # Symfony config & DB migrations
├── composer.json  # PHP dependencies
└── package.json   # Frontend dependencies (Webpack)
```

---

## 7. Relevance to This Repository (gmail-api)

This `gmail-api` project is a Node.js utility that sends emails via the Gmail API using OAuth2 and Nodemailer. Mautic 7.x is relevant in the following ways:

### Integration Opportunities
- **Mautic uses email transports** — including Gmail/SMTP — for sending marketing emails. This Gmail API pattern could serve as a reference for building a custom Mautic transport plugin.
- **OAuth2 authentication** — Mautic 7.x supports modern OAuth2 flows for email services; the pattern in `app.js` mirrors how Mautic handles Gmail OAuth2 credentials.
- **API-first approach** — Mautic 7.x emphasizes API-driven integrations, making it possible to trigger Mautic campaigns from external services like this Gmail utility.

### Recommendations for This Project
1. **Move secrets to environment variables** — `app.js` currently has hardcoded placeholder credentials. Use `dotenv` or similar.
2. **Update dependencies** — `googleapis@63` and `nodemailer@6.4` are outdated. Current versions offer better security and features.
3. **Consider Mautic integration** — If the goal is marketing automation, Mautic 7.x provides a full-featured platform that can replace or extend this simple email sender.

---

## 8. Sources

- [Mautic 7: Columba Edition Release Announcement](https://mautic.org/blog/mautic-7-columba-edition-is-released/)
- [Mautic Releases Page](https://mautic.org/releases/)
- [Mautic 7.0 Release Candidate Blog](https://mautic.org/blog/welcome-to-mautic-7-0-release-candidate-columba-edition/)
- [Mautic Requirements](https://mautic.org/mautic-requirements/)
- [Mautic GitHub Repository (7.x branch)](https://github.com/mautic/mautic/tree/7.x)
- [Mautic LTS Strategy](https://mautic.org/blog/introducing-mautics-new-release-strategy-long-term-support-elts/)
