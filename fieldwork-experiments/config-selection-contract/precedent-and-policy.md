# Configuration-selection precedent and policy options

Source branch: `fieldwork/config-selection-contract`

Upstream contact authorized: `false`

## Question

Wrangler and the Cloudflare Vite plugin currently choose configuration using different anchors, extension orders, and redirect rules. This note asks which parts match established tool behavior, which parts are surprising, and what repair options preserve compatibility.

## What established tools commonly do

### 1. Separate auto-discovery from an explicit override

This is the strongest cross-tool convention.

- TypeScript searches upward for `tsconfig.json` when `tsc` is invoked without files, while `--project` selects an explicit path.
- Prettier searches upward from the file being formatted, while `resolveConfig(..., { config })` selects an explicit config.
- ESLint searches from the target file toward ancestors, while `--config` disables that search and uses the specified file.
- Vite resolves `vite.config.*` inside the project root, while `--config` selects an explicit file relative to the current working directory.
- Cargo performs hierarchical discovery but also supports one or more explicit `--config` overrides.

Implication for Workers SDK: the existing explicit `configPath` escape hatch is good and should remain the strongest selector.

### 2. Make the search anchor part of the contract

Tools choose different anchors for valid reasons:

- file-oriented tools such as Prettier and ESLint resolve from the file being processed;
- command/project tools such as TypeScript and Biome resolve from the current working directory;
- Vite resolves from its explicit project root;
- Cargo resolves from the invocation directory and merges ancestors.

There is no universal correct anchor. The problem is an implicit anchor that changes by caller without being inspectable.

Implication for Workers SDK: `cwd`, script directory, and Vite root can remain different profiles, but the selected profile must be visible in the result.

### 3. Prefer nearest-directory semantics before filename-format preference

Prettier, TypeScript, ESLint flat config, and Biome describe discovery as walking upward until a configuration is found. When several supported names exist in one directory, a fixed same-directory filename priority resolves the tie.

Workers Utils currently performs one complete ancestor search for `wrangler.json`, then another for `wrangler.jsonc`, then another for `wrangler.toml`. This means a farther parent JSON file can beat a nearer child JSONC or TOML file.

That is a valid existing compatibility rule, but it is unusual and difficult to infer from the command line. It should not be silently changed.

### 4. Use an explicit project boundary when ancestor inheritance is dangerous

ESLint's historical cascading system caused confusion when users unknowingly inherited configuration from ancestor directories; ESLint added root boundaries and later simplified its config lookup. Biome also represents root/nested configuration explicitly. Vite avoids ancestor inheritance by anchoring configuration to the project root.

Implication for Workers SDK: Vite's root-only behavior is defensible. Wrangler's upward search is also defensible for subdirectory invocation. The shared protocol should encode the boundary instead of pretending one default fits both.

### 5. Expose provenance and an explanation path

ESLint now provides a config inspector. Cargo documents merge order and relative-path bases. Recent Workers SDK PR `cloudflare/workers-sdk#14897` added a visible message showing that a generated redirected configuration was selected.

Implication for Workers SDK: a selection result should be printable without reparsing debug logs. A command such as `wrangler config explain` or a stable verbose record should show the candidates, winner, source/effective relationship, and reason.

## Cloudflare-specific precedent

Merged upstream PR `cloudflare/workers-sdk#14897` fixed `wrangler triggers deploy` by enabling the same deploy-config redirect already used by `wrangler deploy` and `wrangler versions upload`.

This is important evidence:

- generated configuration is an established internal contract, not a speculative feature;
- redirect adoption is currently command-by-command;
- a command can silently miss generated name or trigger settings when its behavior flag is omitted;
- the accepted immediate repair was another caller-specific opt-in plus a regression test.

That patch is reasonable for the immediate defect. As a long-term pattern, scattered booleans make future drift likely.

## Good protocol decomposition

A shared selector does not need one universal behavior. It needs five explicit stages.

1. **Invocation context**
   - command name;
   - current working directory;
   - script path, when relevant;
   - project root, when supplied by Vite or another framework.

2. **Discovery policy**
   - explicit path or automatic discovery;
   - search anchor;
   - search boundary;
   - nearest-first, format-first, or hierarchical-merge mode;
   - supported filenames and same-directory precedence.

3. **Indirection policy**
   - deploy-config redirect disabled, allowed, or required;
   - source/user config path;
   - generated/effective config path;
   - deploy-config path.

4. **Normalization policy**
   - selected environment or mode;
   - relative-path base;
   - source-versus-generated warning rules.

5. **Selection trace**
   - candidates considered;
   - selected path;
   - stable reason code;
   - rejected-candidate reasons;
   - whether the result is redirected;
   - warnings for ambiguous or compatibility-sensitive layouts.

## Options

### Option A — leave behavior unchanged and add nothing

Pros:

- zero compatibility risk;
- no new API or logging work;
- existing explicit paths remain an escape hatch.

Cons:

- Wrangler and Vite can continue selecting different applications from the same tree;
- command-specific redirect omissions remain easy to introduce;
- users must reverse-engineer the result from source or debug output;
- package tests cannot assert a common contract.

Disposition: acceptable only if the differences are considered private implementation details. They are already user-visible, so this is weak.

### Option B — force Vite to use Wrangler's current selector

Pros:

- direct parity with Wrangler;
- generated redirects can be inherited automatically;
- one implementation path.

Cons:

- Vite could inherit an unrelated ancestor config outside its project root;
- a parent JSON file could beat a nearer root JSONC file;
- changes Vite's established root-owned mental model;
- likely breaking in monorepos and framework adapters.

Disposition: not recommended as an unversioned change.

### Option C — force Wrangler to use Vite's root-only selector

Pros:

- deterministic project-root behavior;
- nearest root config is easy to explain;
- avoids accidental ancestor inheritance.

Cons:

- breaks `wrangler` commands run from nested directories that currently find a parent config;
- requires every caller to know a project root;
- weak fit for script-path and standalone CLI workflows.

Disposition: not recommended as an unversioned change.

### Option D — require an explicit config path in framework-owned workflows

Pros:

- deterministic;
- source and generated config can be selected deliberately;
- no automatic cross-tool ambiguity.

Cons:

- pushes coordination burden onto every framework integration;
- generated paths can change by mode or build output;
- does not help ordinary Wrangler commands;
- creates more setup and environment-variable escape hatches.

Disposition: useful fallback, not a full protocol.

### Option E — shared engine with named policy profiles and a selection trace

Pros:

- centralizes mechanics without forcing identical defaults;
- keeps `wrangler-cli`, `wrangler-dev`, and `vite-root` policies explicit;
- makes redirects and ambiguity testable;
- enables an explain command and stable diagnostics;
- supports later migration based on observed ambiguous layouts.

Cons:

- introduces a broader internal API;
- requires callers to choose a profile deliberately;
- can expose previously accidental behavior that now needs compatibility ownership.

Disposition: recommended.

## Anti-patterns to avoid

- **Format-first ancestor search without disclosure.** It lets a farther file defeat a nearer file for reasons users cannot see.
- **Boolean behavior flags scattered across commands.** PR `#14897` shows how one omitted redirect flag can produce a real defect.
- **Hidden source-to-generated substitution.** A redirect should always report both paths.
- **Caller-defined roots with no trace.** `cwd`, script directory, and Vite root should not be indistinguishable after selection.
- **Changing defaults before measuring ambiguous layouts.** Characterize, warn, and migrate before a breaking precedence change.
- **A single selected-path string as the whole API.** It loses why the path won and whether it represents source or generated configuration.

## Recommended migration sequence

1. Land the cross-package characterization matrix.
2. Introduce a behavior-preserving shared policy/result type.
3. Move existing callers onto named profiles without changing outcomes.
4. Add stable verbose or `config explain` output.
5. Warn only for layouts where another supported profile would choose a different file.
6. Collect compatibility evidence.
7. Consider default alignment only in a documented major-version migration.

## Primary references

- Prettier configuration and `resolveConfig()` documentation.
- TypeScript `tsconfig.json` project discovery documentation.
- ESLint flat-config resolution, precedence, and config-inspector documentation; ESLint's published retrospective on ancestor-cascade confusion.
- Vite project-root and `--config` documentation.
- Biome configuration discovery and root semantics.
- Cargo hierarchical configuration and `--config` override documentation.
- `cloudflare/workers-sdk#14897` for redirected generated configuration adoption in `wrangler triggers deploy`.

No upstream interaction occurred.