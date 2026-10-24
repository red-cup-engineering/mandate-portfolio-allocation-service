# Markets as concurrent games

<!-- 561-group-standards:badges:start -->
[![Red Cup Engineering](https://img.shields.io/badge/561%20Group-Red%20Cup%20Engineering-c0392b)](https://github.com/red-cup-engineering)
[![License: MIT](https://img.shields.io/badge/license-MIT-c0392b)](LICENSE)
[![Indigenous data: CARE](https://img.shields.io/badge/Indigenous%20data-CARE-4b6f44)](https://github.com/red-cup-engineering/.github/blob/main/GOVERNANCE.md)
[![Tips welcome](https://img.shields.io/badge/tips-welcome-d4a017)](https://github.com/561-group/.github/blob/main/TIPS.md)
<!-- 561-group-standards:badges:end -->

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
unverified outcome-claim feedback and identical replay. It makes no venue writes.
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

## One native financial evidence view, not another receipt schema

The shared `marketGameSeavt(state,asOf)` reads the existing Alpaca, Kalshi,
EVM/GMX observations, capital snapshots, quotes, strategies, shared forecast,
conditional decisions and contrary economic outcome evidence directly as
native **SignCells** identified by **SCA** and presented as typed **SEN**
values in **SEAVT** rows. It imports the owning
`@red-cup-engineering/semiotic-eavt-services-section` provider.
The market-game executable exposes this **read-only** view:

```sh
node apps/market-game.mjs seavt --record play.jsonl --at 2026-10-12T22:00:00Z
```

This does not add another journal, JSON schema, account carrier, venue
executor, or report writer. Rows use the **original time of the evidence**,
rather than the time somebody reran the query. A contrary P&L witness becomes
part of the existing SignChain FOUR cell only once that opposing observation
arrives; its SCA triple stays stable as its evidence changes. An admitted
source *claim* or model proposal is explicitly not issuer authentication,
realized accounting profit or an order. Actual original exchange bytes stay
in the venue's immutable source custody; only independently qualified
financial results may enter strategy scoring.

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
* `outcome`: decision/order IDs, an economic-event receipt, observation time,
  claimed integer-cent P&L and optional original source observation. Multiple
  opposing claims for one economic receipt coexist and are **one** logical
  event, never extra independent samples. Claimed P&L is not accepted
  realized profit. Conflicts between distinct source-linked amounts refuse
  subsequent orders for the affected strategy without manufacturing a
  settlement verdict; a bare unsupported objection remains visible but has
  no independent risk-blocking authority.

The real replay command exposes the same reading without storing a new
report or making a venue call:

```sh
node apps/market-game.mjs evidence --record play.jsonl --at 2026-10-12T20:00:00Z
node apps/market-game.mjs evidence --record play.jsonl --at 2026-10-12T20:00:00Z --signs
```

By default the result is a compact per-principal outcome and blocking-strategy
reading; `--signs` includes canonical SignCell addresses only for claims with
counterevidence. Neither mode adds moves to the play.

The existing `readMarketOutcomeEvidence` view groups the retained moves by
economic identity, avoids double counting, and reads evidence only when
available by the decision clock. `projectMarketOutcomeEvidenceSigns` evaluates
the same claims as native SignCell/SignChain FOUR support and opposition.
`composeMarketOutcomeEvidenceHistory` optionally realizes that projection
as native SignCraft revisions and SignGraph 1-chain references, not a second
event database. A `source-linked-claim` is **not** independently authenticated,
accounting-reconciled, or trade-eligible; scored observations and accepted P&L
remain unavailable until independent Operations receiving is completed.

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

### Research attention under Blackwell information order

`evaluateMarketInformationValue` now requires `signalModel.conditionedOnForecastId`
to name the same available, time-qualified joint forecast whose payoff menu is
being valued; the model cannot be repurposed to score research against another
prior. `compareMarketResearchAcquisitions` accepts optional
`garblings: [{finerId, coarserId, kernel}]`, where each row of `kernel` maps a
fine signal ID to probabilities of coarse signal IDs. The existing research
comparator invokes `assertBlackwellGarbling` on **every** offered joint scenario
and validates that the coarse experiment is precisely the fine experiment
followed by the declared stochastic mapping.

This is a conditional Blackwell comparison: with the same fixed feasible
actions, the fine experiment cannot have lower theoretical expected value of
information. Only if its **total compute plus repricing cost** is also no
higher does the comparator exclude the coarser offer from subsequent numerical
EVSI evaluation. An expensive superior signal never eliminates a cheaper
inferior one. Deterministic ties use code-point ordering. This is a real
computational reduction in redundant attention, not a claim of learned
likelihood reliability, source authentication, actual purchase or realized
financial returns. The source research and media consumers can use the same
operator without a separate forecast, journal or probability calculus.

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

## Distributionally robust cross-venue decisions (research-only)

The shared joint-scenario ambiguity module is a further numerical consumer of
the SAME market-game finite scenarios. It does not create an Alpaca, Kalshi or
GMX-specific probability engine. Existing actions use their already defined
complete scenario-dependent **net USD payoffs**, including fee, inventory,
collateral, borrowing, funding, liquidation and adverse-fill assumptions as
applicable. Cash and grant constraints must still be applied by the existing
venue and principal admission layers; this operator neither moves capital
between venues nor constructs an order.

Given the prior joint law p and an explicitly assumed total-variation radius
epsilon, it calculates for each feasible action a:

- the nominal value E_p[U(a,S)];
- the exact min/max E_q[U(a,S)] over joint laws q with TV(q,p) <= epsilon;
- the worst fixed-action regret max_b max_q E_q[U(b,S)-U(a,S)];
- a conditional maximin-expected-payoff action and a minimax-regret action,
  which **may be different** and have no implied execution authority.

The same operator also supports an **optional coherent downside-tail
assessment** without introducing another venue model or risk carrier.
Supply a research preference \`ambiguity.tailFraction\` in the bounded
finite-precision range \`[1e-6, 1]\` to measure the average **net USD loss**
\(-U(a,S)\) over the worst fraction \(\tau\) of the single joint probability
law (expected shortfall, commonly called CVaR). The boundary scenario is
included fractionally according to its probability mass—not by the number
of scenario rows. For each action, the existing output adds both nominal
and **maximum total-variation-conditional expected shortfall** and names
the lowest-worst-tail-loss action in the exact same feasible menu, including
abstention.

The same probability transfer that minimizes expected payoff moves mass
from smaller losses to larger losses. In the finite common scenario order,
it first-order stochastically dominates alternative laws in the declared
TV ball, so the resulting distribution also maximizes upper-tail expected
loss; no second optimizer or per-venue marginal distribution is required.
At \(\tau=1\), its result agrees with minus the corresponding expected
payoff, which provides an additional numerical consistency check.

This is a conditional, single-horizon tail *loss* calculation. It does not
constrain pathwise drawdown, slippage beyond the supplied payoff vectors,
margin availability, liquidation paths not represented in the scenarios,
or multi-period Kelly/log-growth. The tail fraction is a chosen risk
preference, not a measured confidence level, and the TV radius remains
scientifically unverified until independently calibrated. The optional
fraction, selected action and all actual tail values are committed into the
**same** SignCell canonical address and independently recalculated before
SignCraft receiving; an old address cannot borrow a new tail-risk result.

The finite-simplex extremum is obtained by transferring up to epsilon
probability from states with larger payoffs to those with smaller payoffs.
Its returned extremal scenario vectors can be independently checked.
This is neither interval-by-venue arithmetic nor a robust Kelly/log-growth
optimizer, and the action menu must represent feasible *whole* cross-venue
packages rather than pretend that one venue's free cash belongs to another.

Run the same research entrypoint with its fourth mode:

```sh
node apps/market-information.mjs robust examples/joint-ambiguity.json
```

A real packet must supply the existing shared `forecast`, a fixed `actions` menu including
exact zero-payoff abstention, decision time `at`, and an `ambiguity`
record naming the exact `conditionedOnForecastId`, original observation
and availability clocks, source evidence IDs, and `totalVariationRadius` (optionally `tailFraction`).
The included example is deliberately **synthetic**, not calibrated market
evidence or a proposed funded trade. A numerical radius is a caller premise,
never a statistical coverage guarantee manufactured by the optimizer.

`projectConditionalRobustActionSign` in `./settlement-sign-evidence` projects
this conditional numerical derivation through actual SignCell and SignChain
knowledge, committing the entire joint prior, action payoff vectors, radius,
assumption context and evaluations into its canonical cell address. It
exposes standard premise relations for downstream SignGraph/SignCraft use.
The proof witnesses the *conditional calculation*, not radius calibration,
publisher authentication, model skill, a positive alpha estimate, or a
permission to trade. Coesite must independently receive original evidence and
journal revisions before a result can be treated as operational evidence.
Any 561 Group or Causeway public-facing explanation should expose the
assumption and abstention explicitly, and must not disclose principal books,
wallet authority or private order data.

## Mathematical receiving through upstream Metrologic

The financial decision operator remains the existing joint market game and
distributional ambiguity service. Native SignCraft composition additionally
checks its *address-bound* expected payoffs, TV-ball extrema, regret values,
actual adversarial joint-world probability witnesses and optional expected
shortfall using the **independent, reusable** mathematical operations in
`@red-cup-engineering/metrologic/number/finite-law`.

This strengthens the mathematics-to-evidence bridge rather than making a
second forecast system. The financial provider supplies the named worlds,
source-clock-qualified model, complete USD payoff vectors and feasible fixed
actions; Metrologic knows only weights and scalar mathematical quantities.
Each claimed extremal scenario distribution is checked for uniqueness of
world identity, normalized nonnegative mass, the assumed TV budget, and
consistency with its reported value. An invented adversarial witness can no
longer borrow the canonical SignCell proof merely by copying the headline
expected payoff. The optional mass-weighted downside tail calculation is
also independently repeated there.

Metrologic's binary64 result is a **conditional numerical assay**, not a
Lean theorem receipt, empirical probability calibration, proof of realized
trading profit or permission to sign/submit an order. Coesite still owns
original-source custody, SignGraph causality and durable SignCraft receiving.
The 561 Group receives only the independently accepted research fields and
keeps corporate/personal capital principals separate. A source dependency
merge does not establish installed host receiving.

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

## Lane limits and instrument ceilings

`allocateOpportunities` sizes each opportunity at its Kelly fraction of its
lane's capital (`lanes[laneId].fraction` of the observed equity). The per-event,
per-date and open-risk fractions in `limits` then cap it, and so does the
venue's free cash. Every order draws down the same cash balance, so lanes may
each be funded from the whole account. Overlapping lane capital never allocates
beyond the free cash.

- `limits.lanes[laneId]` replaces any of `perEventFraction`, `perDateFraction`
  or `maxOpenFraction` for that lane only. The other lanes keep the global
  limits.
- An opportunity's `maxNewRiskCents` caps the new risk it may add. The caller
  computes it after everything already held on that instrument, for example a
  per-market collateral budget less the position and resting orders.

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
