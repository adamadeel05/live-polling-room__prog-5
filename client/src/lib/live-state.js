// Network replies can arrive out of order. A closed poll never opens again.
export function mergePoll(current, incoming) {
  return current?.id === incoming.id && current.status === 'closed'
    ? { ...incoming, status: 'closed' }
    : incoming;
}

export function mergeResults(current, incoming) {
  if (current?.pollId !== incoming.pollId) return incoming;
  if (current.totalVotes > incoming.totalVotes) return current;
  return current.status === 'closed' ? { ...incoming, status: 'closed' } : incoming;
}
