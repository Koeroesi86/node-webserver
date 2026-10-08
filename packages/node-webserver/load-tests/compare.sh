#!/usr/bin/env bash
# Runs the load test against the base of a pull request and against the pull request itself, one after the other on this machine, and compares them.
#   compare.sh <checkout of the base> <checkout of the pull request> [runs of each side, 3] [duration of a run, 15s] [duration of the CPU bound run, 10s]
# Both sides get the load test (the k6 scripts, example.js and then cpu.js on its own, as it needs the cores) of the pull request, and their own server, which is started for every run and stopped after it:
# two servers at the same time would take the cores from each other. Which side goes first changes with every round, so that a slow stretch of the
# machine does not always hit the same side. SERVER_PREFIX and K6_PREFIX (for example `taskset -c 0-2`) are put in front of the commands, words are split on purpose.
# The results are written to compare-results/ of the current folder, the markdown of the comparison goes to stdout, the exit code is 1 on a regression.
set -uo pipefail

base="$(cd "${1:?checkout of the base}" && pwd)"
head="$(cd "${2:?checkout of the pull request}" && pwd)"
rounds="${3:-3}"
duration="${4:-15s}"
cpu_duration="${5:-10s}"
port_http="${PORT_HTTP:-8080}"
port_https="${PORT_HTTPS:-8443}"
results="$(pwd)/compare-results"
k6_script="${head}/packages/node-webserver/load-tests/example.js"
cpu_script="${head}/packages/node-webserver/load-tests/cpu.js"
compare_script="${head}/packages/node-webserver/load-tests/compare.js"
pid=""

mkdir -p "${results}"
rm -f "${results}"/*.json "${results}"/*.log

stop_server() {
  if [ -n "${pid}" ]; then
    kill "${pid}" 2>/dev/null
    # the workers and lambdas leave when the server does, the port is free when the server is gone
    for _ in $(seq 1 50); do kill -0 "${pid}" 2>/dev/null || break; sleep 0.1; done
    pid=""
  fi
}
trap stop_server EXIT

# the certificate for the secure route is made for the pull request, the base serves it as well
if [ -d "${head}/packages/node-webserver/.certificates/localhost" ] && [ ! -d "${base}/packages/node-webserver/.certificates/localhost" ]; then
  mkdir -p "${base}/packages/node-webserver/.certificates"
  cp -r "${head}/packages/node-webserver/.certificates/localhost" "${base}/packages/node-webserver/.certificates/"
fi

run_side() {
  local side="$1" dir="$2" round="$3"
  # shellcheck disable=SC2086
  (cd "${dir}/packages/node-webserver" && PORT_HTTP="${port_http}" PORT_HTTPS="${port_https}" exec ${SERVER_PREFIX:-} node dist/scripts/load-test-server.js > "${results}/server-${side}-${round}.log" 2>&1) &
  pid=$!
  for _ in $(seq 1 60); do
    curl -fsS -o /dev/null -H 'Host: web.localhost' "http://localhost:${port_http}" 2>/dev/null && break
    sleep 0.5
  done
  # the thresholds are those of the pull request and mean nothing for the base, only the numbers are used, so the exit code of k6 does not matter
  # shellcheck disable=SC2086
  ${K6_PREFIX:-} k6 run --quiet --summary-export="${results}/${side}-${round}.json" \
    -e BASE_URL="http://localhost:${port_http}" -e HTTPS_PORT="${port_https}" -e DURATION="${duration}" -e MIN_REQUEST_RATE=1 \
    "${k6_script}" > "${results}/k6-${side}-${round}.log" 2>&1
  # a fixed arrival rate, so the latency of the workers shows and does not depend on how fast the rest of the server is, the thresholds are not used here either
  # shellcheck disable=SC2086
  ${K6_PREFIX:-} k6 run --quiet --summary-export="${results}/cpu-${side}-${round}.json" \
    -e BASE_URL="http://localhost:${port_http}" -e DURATION="${cpu_duration}" \
    "${cpu_script}" > "${results}/k6-cpu-${side}-${round}.log" 2>&1
  echo "${side} ${round}: $(node -e "try { console.log(Math.round(require('${results}/${side}-${round}.json').metrics.http_reqs.rate) + ' req/s') } catch { console.log('no summary') }")" >&2
  stop_server
}

for round in $(seq 1 "${rounds}"); do
  if [ $((round % 2)) -eq 1 ]; then
    run_side base "${base}" "${round}"
    run_side head "${head}" "${round}"
  else
    run_side head "${head}" "${round}"
    run_side base "${base}" "${round}"
  fi
done

node "${compare_script}" --base "${results}"/base-*.json --head "${results}"/head-*.json \
  --base-cpu "${results}"/cpu-base-*.json --head-cpu "${results}"/cpu-head-*.json
