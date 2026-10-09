# Contributing to BucketNest

Thanks for helping. Bug reports, ideas, docs fixes and code are all welcome.

- **Bugs and ideas:** open an issue on GitHub, or use the forms at
  [bucketnest.org/feedback](https://bucketnest.org/feedback) if you don't have a GitHub account.
- **Security problems:** see [SECURITY.md](SECURITY.md). Please don't post them publicly.

## Working on the code

You need Node 24 and PostgreSQL 16. The [README](README.md#development) has the setup. Before
opening a pull request:

```bash
cd backend && npm run typecheck && npm test      # TEST_DATABASE_URL=… if you don't have Docker
cd frontend && npm run typecheck && npm test && npm run build
```

- **Money is integer cents everywhere.** The finance module (`backend/src/finance`) keeps
  100% line coverage, so add tests with any change there.
- **Every household-scoped query filters by `householdId`.** Records from another household
  return 404.
- **New UI passes the accessibility scan** (`e2e/tests/a11y.spec.ts`): visible labels,
  keyboard access, and no colour-only meaning.
- Keep pull requests focused, and explain the why in the description.

## Licence

BucketNest is licensed under the [GNU AGPL v3 or later](LICENSE). By contributing, you agree
your contribution is licensed the same way.
