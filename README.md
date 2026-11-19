# Agent Refund Court

An agent buys a short launch plan with x402, checks the original answer, and disputes a material quality failure. GenLayer validators independently judge the accepted brief and rubric. A seller-operated worker returns the original USDC principal only after a verified final refund ruling.

[Open the case viewer](https://agent-refund-court.vercel.app) · [Reproduce the demo](docs/reproduction.md) · [Agent skill](skills/agent-refund-court/SKILL.md)

Internet Court supplies the review adapter: mandate → rubric → original evidence → independent decision → consequence. The repository vendors its MIT-attributed adapter and maps it to the demo QualityCourt. It does not call a hosted Internet Court ruling API. [Integration mapping](skills/agent-refund-court/references/internet-court-adapter.md)

## Run

Use Node.js 24 or newer.

```sh
npm ci
npm run build
npm run dev
```

In another terminal, run `npm run dev:web`. The case viewer opens at http://127.0.0.1:5173. Without credentials it shows disabled purchases and an empty case list. Configure your own server using [.env.example](.env.example) and the [reproduction guide](docs/reproduction.md).

An authorized local buyer can run one testnet purchase against the hosted demo:

```sh
npm run demo -- --origin https://agent-refund-court.vercel.app --scenario bad
```

Load `DEMO_ACCESS_TOKEN`, `GEMINI_API_KEY`, and `MODEL_ID` from private configuration. The buyer wallet stays in a private local file. Never place keys in browser code or command arguments. Preserve the printed order ID and resume it with `--resume` after an uncertain result.

## What is real

x402 payment uses Base Sepolia USDC and the official SDK/facilitator. Payment and refund status require actual canonical chain receipts. Quality adjudication runs on the [deployed StudioNet contract](https://explorer-studio.genlayer.com/address/0xb37AFE3AEaed97e45c4715F85b036206CEC6EcE6); source, registrar, runner and final deployment receipt are recorded in [deployment.json](docs/deployment.json).

Buyer, seller and seller-defense inference use Gemini 3.1 Flash-Lite with 384, 512 and 128 output-token limits respectively. See [model measurements](docs/models.md). GenLayer's independent court inference uses its network validators.

The `bad` and `good` scenarios deliberately deliver labelled answer fixtures. Their payment, buyer evaluation, court adjudication when disputed, and any refund use real integrations. The `live` scenario also generates the seller answer. TraceLite is a fictional product brief.

## Validate

```sh
npm run typecheck
npm run lint
npm run test:coverage
npm run test:e2e
python3 -m venv .venv
.venv/bin/python -m pip install '.[contracts]'
npm run contract:lint
.venv/bin/python -m pytest --cov=contracts --cov-branch
```

Unit and integration checks use explicit doubles and do not spend model credits or move funds. Live verification is a separate authorized operation. GitHub Actions runs checks and an authenticated worker advances existing disputed cases; it never creates buyer purchases.

The registrar admits payment facts; GenLayer judges the frozen evidence; the seller worker applies the final ruling. This is a cooperative testnet refund, without escrow or a trustless bridge. [Trust model](docs/trust-model.md)

[Architecture and acceptance plan](docs/plan.md) · [Primary sources](docs/sources.md) · [Submission/video guide](docs/submission.md)
