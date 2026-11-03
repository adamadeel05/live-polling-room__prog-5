// Network replies can arrive out of order. A closed poll never opens again.
export function mergePoll(current, incoming) {
  return current?.id === incoming.id && current.status === 'closed'
    ? { ...incoming, status: 'closed' }
    : incoming;
}

export function mergeResults(current, incoming) {
  if (current?.pollId !== incoming.pollId) return incoming;
  const latest = current.totalVotes > incoming.totalVotes ? current : incoming;
  return current.status === 'closed' || incoming.status === 'closed'
    ? { ...latest, status: 'closed' }
    : latest;
}
