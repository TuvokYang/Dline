/**
 * Serializes read-modify-write sequences over the input queue.
 *
 * The queue is mutated from three independent causes: a user request arriving
 * over RPC, a turn ending, and a tool round finishing. Each of them reads the
 * queue, changes it, and then awaits a disk write. That await yields the event
 * loop, so without a gate a second cause can interleave and act on state the
 * first one is still deciding about.
 *
 * The concrete failure this prevents: a mutation takes a checkpoint, its write
 * fails, and its rollback restores state from before a claim that a delivery
 * completed in the meantime. The entry would become visible and claimable again
 * while the delivery still holds its copy, which breaks at-most-once.
 *
 * A plain promise chain is enough here. There is one queue per task and no
 * cross-process contention, so the only requirement is that these sections do
 * not interleave with each other.
 */
export class InputQueueGate {
	private tail: Promise<unknown> = Promise.resolve()

	/**
	 * Run one section with exclusive access to the queue.
	 *
	 * @returns whatever the section returns. A rejection propagates to this
	 * caller while leaving the gate usable, so one failed section does not
	 * deadlock the ones behind it.
	 */
	run<T>(section: () => Promise<T>): Promise<T> {
		const attempt = this.tail.then(section, section)
		this.tail = attempt.catch(() => undefined)
		return attempt
	}
}
