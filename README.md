# Markets as concurrent games

One replayable decision carrier connects public observations, calibrated joint
scenarios, strategies, venue capital, proposed orders and observed outcomes.
Kalshi, Alpaca and EVM remain distinct venues. Cash on one venue cannot fund an
order on another, and an on-chain protocol is identified by chain, protocol and
finalized block. EVM support presently connects GMX perpetual order building;
other protocols require their own payoff and execution adapters.

The existing `allocate` and `allocate-opportunities` exports retain their
mandate allocation and capped binary-bet functions. `market-game` uses the
upstream gaming rule player and position sizer for joint returns, with existing
positions included in every scenario. The binary optimizer delegates to that
same numerical implementation. No second optimizer or venue executor exists.

## Run and inspect

From this package directory:

```sh
node examples/market-game.mjs --record /tmp/example-market-play.jsonl
node apps/market-game.mjs replay --record /tmp/example-market-play.jsonl
node apps/market-game.mjs collect --record /tmp/example-market-play.jsonl --sources examples/public-sources.json
```

The example is **synthetic**. Its scenario prices, likelihoods and calibration
are demonstration inputs, not market forecasts. It exercises funded proposals
for all three venues, a prediction-market observation changing allocations on
the other venues, Alpaca intent admission, GMX unsigned order building,
receipt-based performance and identical replay. It makes no venue writes.
The public collector actually reads the New York Fed and Kalshi without keys.

For actual work create an empty JSONL play and append moves with:

```sh
node apps/market-game.mjs ingest --record play.jsonl --input move.json
node apps/market-game.mjs ingest --record play.jsonl --input news.json --format alpaca-news
node apps/market-game.mjs ingest --record play.jsonl --input log.json --format evm-log
node apps/market-game.mjs plan --record play.jsonl --policy policy.json --at 2026-10-06T15:00:00Z --append
```

`news --feeds feeds.json [--cursor cursor.json] --record play.jsonl` reuses the
house communicating faculty's RSS/Atom reader. Feed entries are `{id,url,kind}`;
pass a cursor path to create or update its deduplication state. Existing
Kalshi source CloudEvents can be ingested with `--format newswire`. Alpaca news
retains publisher, URL, update time and symbols. EVM logs retain chain, block,
transaction, log index and reorg/removal status. Raw news never creates an edge.
For a single JSON endpoint the collector uses a declared selector path and
limits the response to 1 MiB. It timestamps admission after fetch completion.

## What an agent supplies

The playable moves are `observe`, `account`, `quote`, `strategy`, `forecast`,
`condition`, `decide`, and `outcome`. A decision is bound to the exact position
hash; reordered/missing entries fail replay. Independent observations commute.

* `observe`: immutable `id`, public `source`, `availableAt`, `observedAt`,
  `value`; news codecs also preserve publisher lineage. Contradictory records
  coexist. A model must state how it interprets them.
* `account`: venue, observation time, equity/free cash in integer cents,
  reserved capital and optional factor exposure. Free cash excludes open-order
  commitments and borrowed buying power. Use the existing account reconciliation
  and venue adapters to obtain these readings.
* `quote`: instrument, venue, carrier (`binary`, `asset`, or `collateral`),
  side, executable entry price, known quantity, lot size, observation time and
  payoff horizon. Trading/exit and holding/funding costs are required. EVM also
  requires chain, protocol, finalized block and protocol-specific payoff values.
  Kalshi's `market-game-observations` export derives these quotes from known
  depth using gaming's exact book walk and observed fee terms. A gap, closed
  market or unknown book cannot generate a quote.
* `strategy`: quote IDs, thesis, falsifier and source evidence IDs. A fired
  falsifier blocks allocation. Two strategies cannot copy the same liquidity.
* `forecast`: shared scenario probabilities and terminal values keyed by quote
  ID, held-position P&L by venue in every scenario, horizon and evidence IDs.
  Binary values are YES settlement payouts, even for a NO quote. Asset values
  are exit prices. Collateral values are net collateral proceeds including
  liquidation/ADL behavior. All payoffs use one stated horizon. Forecast
  calibration must refer to a scored observation, beat its baseline and meet
  the policy's sample minimum. Calibration is supplied empirical evidence; the
  planner does not establish alpha by accepting a record.
* `condition`: observation ID and a measured `scenario-likelihood-model`.
  The model identifies its source, numeric feature path, bins, scenario
  likelihoods and out-of-sample calibration. It updates the **common** scenario
  probabilities, so prediction-market information can alter equities and
  crypto allocations. Revisions recompute from one prior; multiple signals
  require a joint calibrated model. Market-implied probabilities are observations,
  not automatically physical probabilities or causal influence coefficients.
* `outcome`: decision/order IDs, unique execution or valuation receipt,
  observation time and realized P&L. Proposals and unfilled shadows add no wins.

Policy explicitly states observation age, minimum calibration sample count,
venue cash floors, maximum deployed/instrument fractions, common-factor caps,
scenario-loss limit and Kelly multiple <= 1. These are *scenario* constraints;
they are not a theorem bounding pathwise drawdown. Quotes reserve transition
and holding costs. Final discrete quantities are checked again against limits.
Existing holdings that already breach limits require a separate reduction
decision; new capital is refused rather than silently called a hedge.

## Condition actual signal receipts on the SAME joint market game

The shared `joint-scenario-condition.mjs` is now the single finite Bayes
operator for both this package's existing replayable `condition` move
(binned numerical features) and its categorical research signal model. These
are different evidence-admission interfaces, **not two independent probability
theories**. Both change the same scenario probabilities across every affected
market and portfolio action.

The market-information command exposes three read-only workflows:

```sh
node apps/market-information.mjs assess acquisition-packet.json
node apps/market-information.mjs compare acquisition-menu.json
node apps/market-information.mjs condition received-signal-packet.json
```

The `condition` packet supplies `forecast` (the existing joint-scenario
carrier), `signalModel`, `observation`, `at`, and optionally a fixed
`actions` payoff menu. `signalModel.conditionedOnForecastId` MUST name the
exact forecast that supplied its prior probabilities. The received
`observation` supplies a distinct `id`, named `signalId`,
`observedAt`, `availableAt` and the original `evidenceIds`. Model release,
original observation and receipt clocks are checked separately.

This returns a joint posterior under the precommitted emission model, its
entire scenario distribution, information gain, and (when actions are supplied)
a conditional ranking of the **same** feasible actions, with abstention.
An impossible observation is a model conflict, not an inferred certain win.
The finite Bayes function is source-agnostic, so it is reusable for priced
research from news, filings, sports, commodity reports, or weather—provided
those signals have a frozen, independently evaluated likelihood kernel.

`projectObservedScenarioConditioningSign`, exported from
`./settlement-sign-evidence`, realizes a successfully derived posterior as
an actual SignCell + SignChain conditional proof of a *model update*.
Its context commits to the prior, frozen likelihood, observation receipt,
source/rule/target identity and all posterior scenario weights. Its
`sourceRelations` are suitable for an existing SignGraph/SignCraft causal
journal; the projection does **not** authenticate original publisher bytes or
assert that a market settles YES. Coesite must separately verify the source,
address and journal receipt. No new content-address, graph or signer is
introduced here.

`id` on the research posterior is only a compositional lineage reference,
not a substitute for the canonical SignCell content address. The original
stateful market game's `condition` move retains its existing
`hashPosition` adoption semantics and out-of-sample calibration gate.

## Native SignCraft/SignGraph receipt composition

The `./scenario-sign-history` export is an executable, pure bridge from a
received categorical source signal to the house's **actual** SignStuff
capabilities. Its `composeConditionalScenarioHistory` takes a checked
`projectObservedScenarioConditioningSign` and three original-byte
`sourceReceipts` (prior forecast, frozen emission model, actual observation).
Every receipt names an existing source ID, source reference, issuer, SHA-256
digest, original observation clock and first-available clock; the inference
proof must identify exactly those three predecessors.

The composer produces authentic
`@red-cup-engineering/signcraft/history` revisions: source receipts are
observed before the inference's SignCell, and the inference revision's actual
`parents` point to that prior frontier. Typed reference *cells* link each
premise to the posterior. The real
`@red-cup-engineering/signgraph/cell-graph` derives their relation graph.
No local `causes` array masquerades as a SignCraft journal. All-inference
replays are idempotent; contradictory reuse of an existing predecessor or
proof identity is refused.

This is a pure provider of a proposed native history, not a filesystem writer.
Coesite owns persistent atomic publication and independent replay:
`@coesite-operations/prediction-market-operations-services-section/received-scenario-history`.
Source digests bind claimed bytes but do not authenticate their issuers; the
Operations receiver independently reads and checks those bytes plus actual
publisher custody before committing. A canonical SignCell address names a
*triple*, while SignCraft revisions retain its **evidence**, so both addresses
and complete witnessed causal ancestry must be checked.

## Consume the funded decision

* Kalshi desk: `cycle --market-decision=decision.json` caps new placements
  alongside its existing lane certifications, risk limits and arming state.
* Alpaca `formAggressivePortfolioIntent`: pass `marketDecision` and `asOf`.
  Its normal principal contract and issuer evidence still apply. The execution
  transport rechecks decision freshness before an admitted venue effect.
* GMX `buildPerpOrder`: pass `marketDecision`; chain, protocol, direction and
  collateral must match its funded allocation. Existing grants, leverage limits,
  contract allowlists and the custodian's signing step remain necessary.

Shared Alpaca orders use the funded quantity and entry ceiling as a limit
order; equities use `day` and crypto uses `ioc`. GMX collateral models name
their leverage and collateral token, and the builder refuses a different
exposure. Kalshi also checks the funded quantity and maximum entry cost.

These are proposals with per-venue limits, not atomic cross-venue execution.
The shared decision path is available to these consumers; existing scheduled
trading jobs are not switched to a new model by installing it. A paper replay
and a valid content hash establish behavior, not profitable operation.

## Public grounding

* [Kalshi order books](https://docs.kalshi.com/getting_started/orderbook_responses):
  YES/NO bid complements, fractional quantities and subpenny prices.
* [Kalshi series](https://docs.kalshi.com/api-reference/market/get-series) and
  [fee schedule](https://kalshi.com/docs/kalshi-fee-schedule.pdf): settlement
  sources, product fee multipliers and maker fees. Whole-cent research/desk
  consumers reserve a conservative fee bound; the scheduled combined-cost
  centicent rounding is separately exposed by `scheduledFee`.
* [Alpaca news](https://docs.alpaca.markets/us/docs/streaming-real-time-news):
  publisher/symbol linkage and separate creation/update times.
* [GMX costs](https://docs.gmx.io/docs/trading/fees/) and
  [liquidations](https://docs.gmx.io/docs/trading/liquidations/): funding,
  borrowing, price impact and liquidation matter beyond the spot price.
* [Kelly](https://www.theparticle.com/cs/bc/dsci/kelly_56.pdf),
  [multi-period portfolio optimization](https://arxiv.org/abs/1705.00109) and
  [distributionally robust Kelly](https://arxiv.org/abs/1812.10371): growth,
  transaction/holding costs and model uncertainty are separate concerns.
  The current optimizer is finite-scenario log growth; it does not implement
  the cited robust-distribution or multi-period programs.

## The same move as research and publication

The playable observation is also input to `research-publication`: an explicit
assignment selects scalar facts, units, a research question and the upstream
wire. The content-addressed packet carries original observation identities,
availability clocks and source lineage. It contains no account or order state.
`examples/research-assignment.json` chooses the latest observed New York Fed
funding rate and Kalshi KXFED fee terms by their declared external IDs.
The public-source configuration retains bounded HTTP responses so the newsroom
can bind every selected field to an exact source span.

```sh
node apps/market-game.mjs research --record play.jsonl --assignment examples/research-assignment.json --output research.json
node apps/market-game.mjs ingest --record another-play.jsonl --input purchased-briefing.json --format koios-research
```

Koios's `bin/koios-market-research.mjs --record play.jsonl --packet research.json`
admits these facts into the existing Content Mill journal. Optional
`--filum-store DIRECTORY --resource-url HTTPS_URL` writes the corresponding
bundle through Filum's existing wire carrier, including the structured packet.
This wire representation is publicly readable; it is not proof of a paid
Filum-to-Koios acquisition. The Koios briefing is the existing paid product.

The news line drafts from the grounded claims, assesses the manuscript,
uses its standing publication authority and releases it through its existing
publisher. The release stage then publishes the accepted prose plus its richer
research to the current x402 briefing. Publication failure is retained on the
edition and retried in later bounded release turns. The original sources, not
Filum and Koios restating them, establish source lineage. A purchased packet
reenters the strategy system as observations and still needs a calibrated model
before affecting scenarios.

The isolated Koios `examples/market-research.mjs` demonstration exercises actual
public fields, exact claim spans, Filum's JSON surface, the current-briefing
admission/delivery race and return-to-game replay. Its briefing prose is a
mechanical demonstration, with no editorial acceptance or production release.
At implementation time the local inference dispatcher could not load because
`organizing/src/agency/index.mjs` imports missing `forms.mjs`. Agent drafting and
live release through that dispatcher remain unverified. The market catalog
compiler also fails at the structural-claims offer because of that same import.

Five possible economic uses share this evidence: audience advertising,
structured-data sales, internal decisions, publication of measured results,
and licensed models or research services. Track shared acquisition costs,
publication/inference costs, settled revenue and realized execution P&L.
Reusing a fact does not itself establish an additional return. Synthetic
outcomes, manuscript acceptance and a published dataset do not prove alpha.

Successful x402 settlement witnesses additionally retain the delivered research
packet ID, public source observation IDs, product ID and exact response digest.
The existing transaction identity and seller-booking checks remain unchanged.
This links a data sale to its research carrier without copying the customer's
response or private trading state into the settlement log. A synthetic
settlement-context demonstration verified this linkage; no sale was executed.
