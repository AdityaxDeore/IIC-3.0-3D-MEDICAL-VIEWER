"use client";
//#region src/shims/internal/app-prefetch-fetch-queue.ts
const APP_PREFETCH_FETCH_SLOT_RELEASE_KEY = Symbol.for("vinext.appPrefetchFetchSlotRelease");
const MAX_DEFAULT_APP_PREFETCH_REQUESTS = 4;
const defaultAppPrefetchQueue = [];
/** Lets a consumer promote or cancel the request behind a promise it already holds. */
const appPrefetchFetchControls = /* @__PURE__ */ new WeakMap();
let activeDefaultAppPrefetchRequests = 0;
let defaultAppPrefetchDrainScheduled = false;
function drainDefaultAppPrefetchQueue() {
	defaultAppPrefetchDrainScheduled = false;
	while (activeDefaultAppPrefetchRequests < MAX_DEFAULT_APP_PREFETCH_REQUESTS) {
		const run = defaultAppPrefetchQueue.shift();
		if (!run) return;
		activeDefaultAppPrefetchRequests += 1;
		run();
	}
}
function scheduleDefaultAppPrefetchDrain() {
	if (defaultAppPrefetchDrainScheduled) return;
	defaultAppPrefetchDrainScheduled = true;
	queueMicrotask(drainDefaultAppPrefetchQueue);
}
function releaseAppPrefetchFetchSlot(response) {
	const release = response[APP_PREFETCH_FETCH_SLOT_RELEASE_KEY];
	if (release === void 0) return;
	response[APP_PREFETCH_FETCH_SLOT_RELEASE_KEY] = void 0;
	release();
}
/**
* Low-priority App Router prefetches share a small request queue. The consumer
* must either snapshot the returned Response with snapshotRscResponse() or call
* releaseAppPrefetchFetchSlot() when it drops the response without consuming it.
*/
function scheduleAppPrefetchFetch(fetcher, priority) {
	const controller = new AbortController();
	if (priority === "high") {
		const promise = fetcher(controller.signal);
		appPrefetchFetchControls.set(promise, { cancel: () => controller.abort() });
		promise.then((response) => {
			response[APP_PREFETCH_FETCH_SLOT_RELEASE_KEY] = () => appPrefetchFetchControls.delete(promise);
		}, () => appPrefetchFetchControls.delete(promise));
		return promise;
	}
	let runner;
	let rejectPromise;
	let started = false;
	const promise = new Promise((resolve, reject) => {
		rejectPromise = reject;
		runner = () => {
			started = true;
			let didRelease = false;
			const release = () => {
				if (didRelease) return;
				didRelease = true;
				appPrefetchFetchControls.delete(promise);
				activeDefaultAppPrefetchRequests -= 1;
				drainDefaultAppPrefetchQueue();
			};
			try {
				fetcher(controller.signal).then((response) => {
					response[APP_PREFETCH_FETCH_SLOT_RELEASE_KEY] = release;
					resolve(response);
				}, (error) => {
					appPrefetchFetchControls.delete(promise);
					release();
					reject(error);
				});
			} catch (error) {
				appPrefetchFetchControls.delete(promise);
				release();
				reject(error);
			}
		};
	});
	defaultAppPrefetchQueue.push(runner);
	appPrefetchFetchControls.set(promise, {
		runner,
		cancel: () => {
			if (started) {
				controller.abort();
				return;
			}
			const index = defaultAppPrefetchQueue.indexOf(runner);
			if (index === -1) return;
			defaultAppPrefetchQueue.splice(index, 1);
			appPrefetchFetchControls.delete(promise);
			controller.abort();
			rejectPromise(controller.signal.reason);
		}
	});
	scheduleDefaultAppPrefetchDrain();
	return promise;
}
/** Cancel a queued or in-flight prefetch request. No-op once it has settled. */
function cancelAppPrefetchFetch(promise) {
	if (promise === void 0) return;
	appPrefetchFetchControls.get(promise)?.cancel();
}
/**
* Start a still-queued prefetch request immediately.
*
* A navigation that reuses an in-flight prefetch awaits that prefetch's
* promise. When the request is only queued, the navigation would otherwise wait
* for unrelated prefetch response bodies to finish before its own request even
* starts — indefinitely if one of those streams stalls. A promoted request is
* no longer a prefetch, it is the navigation, so it bypasses the concurrency
* cap instead of waiting for a slot.
*
* No-op when the request has already started or was never queued.
*/
function promoteAppPrefetchFetch(promise) {
	if (promise === void 0) return;
	const runner = appPrefetchFetchControls.get(promise)?.runner;
	if (runner === void 0) return;
	const index = defaultAppPrefetchQueue.indexOf(runner);
	if (index === -1) return;
	defaultAppPrefetchQueue.splice(index, 1);
	activeDefaultAppPrefetchRequests += 1;
	runner();
}
//#endregion
export { cancelAppPrefetchFetch, promoteAppPrefetchFetch, releaseAppPrefetchFetchSlot, scheduleAppPrefetchFetch };
