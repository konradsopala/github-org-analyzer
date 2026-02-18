## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

## CSV Structure

The input CSV file must contain the following columns:

| Column | Description |
|--------|-------------|
| `company_name` | Name of the company (used as a label in results) |
| `github_org_url` | GitHub organization or user URL (e.g. `https://github.com/vercel`) |

Example:

```csv
company_name,github_org_url
Vercel,https://github.com/vercel
Tailwind Labs,https://github.com/tailwindlabs
```

## Learn More

This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app). To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!
