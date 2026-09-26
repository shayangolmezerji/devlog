---
title: "A dead man's switch for SSH, and why dry-run made it testable"
description: "How an env-var tripwire and a fake ss turned a firewall-rewriting watchdog into 246 checks that never need root."
date: 2026-09-23
tags: [systemd, linux-recovery]
draft: false
---

You are three hundred miles from a server about to rewrite its firewall. If
the new ruleset drops your own SSH traffic, you do not discover that by typing,
you discover it by not getting an answer. The usual recovery is a reboot into a
rescue system: an outage you scheduled yourself. `deadman-ssh` takes the
decision out of your hands. Arm it before the change; if you do not come back,
the box puts its own configuration back, either when the countdown runs out or
when the session you are working from leaves the socket table and stays gone
through a grace period.

The hard part to believe is not the design. It is that a tool whose whole job
is to rewrite firewall rules under root was testable at all on a machine with no
root, no network change, and no SSH session to lose.

## What made it testable

Three environment variables, and they only work together.

`DEADMAN_DRY_RUN=1` is a tripwire inside one function. Every privileged action
in the tool goes through `dm_priv`, and `dm_priv` checks dry-run before it
escalates, verbatim from `lib/deadman-lib.sh`:

```bash
# dm_priv <command> [args...]: the only path to the host. Dry-run prints the
# exact argv and succeeds without touching anything.
dm_priv() {
  local -a runner
  if dm_is_dry_run; then
    dm_log "DRY-RUN $(dm_quote "$@")"
    return 0
  fi
  mapfile -t runner < <(dm_runner_argv)
  dm_log "EXEC $(dm_quote "${runner[@]}" "$@")"
  "${runner[@]}" "$@"
}
```

With dry-run on, the whole arm -> capture -> expire -> rollback sequence prints
what it would run and touches nothing on the host. That is what lets the suite
drive a network-rewriting tool as an ordinary user.

`DEADMAN_RUNNER='false'` is the safety net under the safety net. The escalator is
pinned to the `false` binary for the entire run, so a test that reaches a real
privileged call does not escalate, it fails. Dry-run should mean no test reaches
`dm_priv`'s execute branch, and if one does, the wrong thing must not succeed.

The fake `ss` is the third piece. The session probe reads
`ss -Htn state established` to decide whether your login is still in the socket
table. On a developer laptop there is no controlled way to make a real SSH
session appear and then vanish mid-test, and iproute2 changes which columns it
prints between releases. So the harness puts a one-line `ss` ahead of the host's
own on `PATH` (`tests/fixtures/bin/ss`):

```bash
#!/usr/bin/env bash
# Stands in for iproute2's `ss` so the socket probe can be tested against a
# table this harness wrote instead of the host's real sessions. The arguments
# are ignored: what is under test is which column the endpoints land in, and
# real iproute2 changes that between releases.
set -euo pipefail

cat "${DM_FAKE_SS_TABLE:?harness must set DM_FAKE_SS_TABLE}"
```

It prints whatever file the harness points at. That is enough to show the probe
both column layouts iproute2 has used, to make a socket disappear halfway
through a run, and to make the table unreadable on purpose. The probe tests run
with `SSH_CONNECTION` pointed at `192.0.2.0/24`, documentation space, so no peer
of any real host can ever match it.

Without dry-run there is nothing to test without root. Without the runner pinned
to `false`, a dry-run bug escalates for real. Without the fake `ss`, the session
probe is untestable and the interesting failures, the ones about a dropped
connection, cannot be produced on command.

## The hook contract fell out of making that observable

The switch knows nothing about what it rolls back. A hook is an executable in a
directory, called `save <dir>` at arm time and `restore <dir>` later. The
contract is short (`README.md`, "Writing a hook"):

```
<NN-name> save <snapshot-dir>      capture the current state, write it into <snapshot-dir>
<NN-name> restore <snapshot-dir>   put it back
exit 0    done
exit 77   nothing applicable on this host, recorded as a skip
other     failure
```

Every rule in it exists because a test needed it to be assertable:

- `save` runs in filename order, lowest first. `restore` runs in reverse among
  the hooks that captured, so the newest change is undone before the older one it
  sits on. The suite proves the order by grepping a trace file for `restore
  60-beta` and `restore 50-alpha` and asserting beta's line number is smaller.
- Only hooks whose `save` returned 0 get a `restore`. You cannot restore from a
  snapshot that was never taken, and "a skipped hook is never restored" is a test
  that counts restore lines in the trace, not a comment claiming it.
- `exit 77` exists so "this box has no nft" is a skip, not a failed rollback.
  `dm_require_cmd` turns a missing tool into 77. Without it a host that simply
  does not use nftables would report its rollback as broken.
- A capture that fails aborts the arm before your change runs, restoring what it
  already took. Three tests exercise this with dry-run switched off, because
  dry-run is exactly what would hide the answer: a payload that fails, a capture
  that fails, a capture interrupted mid-arm. They use fixture hooks that write
  only inside the scratch directory.

## What the suite reports

```
$ bash tests/run.sh
...
== shellcheck on every script
  SKIP shellcheck is not installed on this machine
       install it, or run the CI workflow, to get this check
...
246 checks passed, 0 failed
```

27 groups, 246 checks, no failures, and one group that checks nothing here. The skip is
accurate: `shellcheck` is not installed on this box and nothing here installs
packages. It is closable without root, though, and closing it tells you something.
The binary taken out of the `koalaman/shellcheck:stable` image and put on `PATH`
turns that same run into 256 checks, ten of them lint, and 256 is what the CI
workflow's suite job reports on every push, because that runner has the package.
The lint found one defect, and it found it in the harness: `SC2155` on a
`local file=$(...)`, where `local` returns its own status, so a failed
substitution left `$file` empty and the test went on to rewrite a path that does
not exist. Two runs went red on it before `8a5f27d` split the declaration from the
assignment, and the README names both. `bash -n` passes on every file, and `bash
-n` is a syntax check only. The harness is plain bash plus coreutils on purpose:
the box you administer has neither bats nor pytest, and a switch you can only
test on a developer machine is not testable where it runs.

## A defect the suite caught, not one it was written to pass

The variable `DEADMAN_LIB` tells a hook where to find `deadman-lib.sh`, which is
where `dm_priv` lives. A hook needs `dm_priv` at restore time: restore is the
whole reason a hook exists.

The bug was in the switch, not in any hook. `DEADMAN_LIB` used to be exported
only inside `cmd_arm`. Four separate processes reach a hook: the arm, a
`rollback` an operator types later, the detached watchdog that fires on its own,
and `recover` running a restore after a reboot. Only the first of those ever ran
`cmd_arm`. A hook that could not derive the library path from its own location,
which a custom `DEADMAN_HOOKS_DIR` cannot, would reach `restore` with
`DEADMAN_LIB` empty and silently source no `dm_priv`. The failure would surface
at 3 a.m. as a rollback that could not run.

The fix is two lines at the one place every hook is invoked, in `run_hook`
(`bin/deadman-ssh`):

```bash
  mkdir -p "$snap"
  # Every hook runs here, in whichever process reached it: the arm, a rollback
  # typed later, the watchdog, or recover. Export the library at the call, not
  # at the arm, or a hook that cannot find dm_priv fails at restore time.
  export DEADMAN_LIB
  "$hook" "$action" "$snap" || rc=$?
```

The test that drove it out, `test_hooks_see_the_library_in_every_process`, uses
a fixture hook whose only job is to fail if the library is missing:

```bash
save)
  printf 'DEADMAN_LIB=%s\n' "${DEADMAN_LIB:?a hook must be able to find the library}" >"$snap/note"
  ;;
restore)
  [[ -n ${DEADMAN_LIB:-} ]] || { printf 'libseen: DEADMAN_LIB never reached the restore\n' >&2; exit 1; }
  [[ -r $DEADMAN_LIB/deadman-lib.sh ]] || {
    printf 'libseen: %s is not readable\n' "$DEADMAN_LIB/deadman-lib.sh" >&2
    exit 1
  }
```

It runs the restore through all four processes, the reboot branch of `recover`
included, which is the row an arm-time export never covered. Before the fix the
library assertions were red on `main`; `export DEADMAN_LIB` at the call turned
them green without touching any hook. This is the part worth stating plainly: the
suite found a real defect in code the suite was not written to flatter. A test
that has only ever passed tells you far less than one that caught something and
reported it red first.

## The flake was a signal disposition, not a slow machine

One group, `a signal while capturing aborts the arm and restores what was
saved`, had a habit: green alone, red when the suite ran several ways at once,
and always red as a block of eight failures rather than one. The first answer
was that `sleep 0.5` before the `kill -INT` was too tight for a busy box, so the
signal arrived after the arm had moved past the point where an abort means
anything. A patch replaced the delay with a poll for the trace line the slow
fixture hook writes when it enters. That patch is reasonable code and it changed
nothing: three concurrent runs of the patched tree printed
`238 checks passed, 8 FAILED`, exactly the numbers three concurrent runs of the
unpatched tree printed. The failure was not the size of the window.

What varied was not the load, it was how the suite had been started. Run in the
foreground, the group is green. Run it with `&`, redirecting its output, and it
is red every time, with nothing else in the run disturbed. Two lines show why:

```
$ printf '%s\n' 'trap "echo caught; exit 1" INT TERM' 'sleep 3' > /tmp/sig-probe.sh
$ bash /tmp/sig-probe.sh > /tmp/sig-bg.out 2>&1 & pid=$!
$ sleep 0.4; kill -INT "$pid"; wait "$pid"; echo "rc=$?"; cat /tmp/sig-bg.out
rc=0
$ bash /tmp/sig-probe.sh > /tmp/sig-bg2.out 2>&1 & pid=$!
$ sleep 0.4; kill -TERM "$pid"; wait "$pid"; echo "rc=$?"; cat /tmp/sig-bg2.out
rc=1
caught
```

A shell with no job control starts a background job with `SIGINT` ignored. Bash
will not install a handler for a signal its process entered that way, and it does
not warn you when you ask for one. So the arm's `trap ... INT TERM` installed the
`TERM` half and silently dropped the `INT` half, `kill -INT` went to a process
that was discarding it, and the capture ran to the end and applied the change.
The eight assertions describe an abort that never happened. Foreground, the trap
is real, which is exactly why the group looked fine in isolation.

`bin/deadman-ssh:503` traps both names into one handler, so nothing about the
switch's behaviour is untested by choosing between them. The harness now reads
`SigCgt` out of `/proc/<pid>/status` for the arm it started and signals whichever
of the two that mask says the process is catching, and it prints the choice: a
foreground run says `arm catches SIGINT`, three runs launched with `&` say
`arm catches SIGTERM`, and all four end `246 checks passed, 0 failed`. The
handshake stayed, because it is still the right shape. Bash defers a trap until
the child it was waiting on returns, so the arm's abort point is wherever the
fixture hook ends rather than wherever the kill was sent: the harness waits for
the hook's entry line, dispatches the signal, creates a file, and only then does
the hook leave its `save`. That converts a two second margin into a guarantee,
which is worth the one extra variable. It was never the fix on its own, and the
`238` above is the proof.

The finding has an operator half, which is why it is in the README's
Limitations and not only in the test. An arm you start with `&` from a script
cannot be interrupted with Ctrl-C at all. It finishes the capture and applies the
change. `kill -TERM` reaches it.

## Two things it cannot see

The README's Limitations section names what is unproven. Two findings are worth a
paragraph each because they undercut the tool's own headline claims.

`setsid` does not escape the login session's cgroup. `start_watchdog` runs the
watchdog under `setsid nohup` so that killing the shell does not kill the process
watching it. `setsid` gives the child a new session and a new process group, but
not a new cgroup. Measured on the host this was written on, the detached watchdog
stayed in `user.slice/user-1000.slice/session-1.scope`, its parent's scope. Where
systemd's `logind` has `KillUserProcesses=yes`, tearing the session down on
logout kills everything in that scope, watchdog included, and if the risky change
is the reason you cannot reconnect there is nothing left counting down. Escaping
the scope means starting the watchdog outside the login session: a systemd unit
or a root-side helper, not a line of this script. It is not implemented, and the
exposure is unverified against a real session teardown here. Until it is settled,
running `deadman-ssh status` from a second machine is part of the procedure.

The socket probe cannot see the failure the tool was built for. A ruleset that
silently drops your traffic sends no FIN and no RST, so the server-side socket
stays `ESTABLISHED` in the kernel and `ss` keeps listing it. The probe reads the
session as present; the early rollback never fires. The socket does leave the
table when sshd is killed or the host reboots, and when the client sends a proper
close, so the probe covers some losses. "I locked myself out with a drop rule" is
not one of them. The TTL is what saves you there, so arm with a countdown you can
afford to sit through and verify from elsewhere before you confirm. There is one
fix, and it is the reason to configure it: with `sshd` given
`ClientAliveInterval` and `ClientAliveCountMax`, an unresponsive client is
disconnected after the two multiplied together, the socket leaves the table, and
the probe does see the loss (`sshd_config(5)`). That sentence is an argument from
how TCP keeps a socket plus what that page says sshd does, not a measurement. A
test for it needs a host whose traffic you can drop, which this machine is not, so
no number is claimed.

Both findings stay in the README and the ADR instead of being dropped, because a
safety net whose limits are not written down is not a safety net.
