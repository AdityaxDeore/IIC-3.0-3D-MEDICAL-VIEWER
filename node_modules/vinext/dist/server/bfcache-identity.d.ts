//#region src/server/bfcache-identity.d.ts
type ParallelSlotBindingState = "active" | "default" | "unmatched";
declare function createNestedBfcacheSlotSegmentId(parentSlotId: string, level: number): string;
declare function isNestedBfcacheSlotSegmentId(id: string): boolean;
declare function isNestedBfcacheSlotSegmentIdFor(id: string, parentSlotId: string): boolean;
type BfcacheSegmentIdentity = string;
type BfcacheSegmentDescriptor = {
  kind: "page";
  graphId: string;
  rootBoundaryId: string | null;
  boundSegmentKey: string;
} | {
  kind: "layout";
  graphId: string;
  rootBoundaryId: string | null;
  boundSegmentKey: string;
} | {
  kind: "template";
  graphId: string;
  rootBoundaryId: string | null;
  boundSegmentKey: string;
} | {
  kind: "slot-shell";
  slotGraphId: string;
  ownerLayoutGraphId: string | null;
  boundOwnerSegmentKey: string;
} | {
  kind: "slot";
  slotGraphId: string;
  ownerLayoutGraphId: string | null;
  state: ParallelSlotBindingState;
  activeRouteGraphId: string | null;
  interceptionTargetRouteGraphId: string | null;
  boundSegmentKey: string;
} | {
  kind: "sibling-interception";
  interceptionGraphId: string;
  sourceRouteGraphId: string;
  rootBoundaryId: string | null;
  boundSegmentKey: string;
  sourceBoundSegmentKey: string;
};
declare function deriveBfcacheSegmentIdentity(descriptor: BfcacheSegmentDescriptor): string;
//#endregion
export { BfcacheSegmentDescriptor, BfcacheSegmentIdentity, createNestedBfcacheSlotSegmentId, deriveBfcacheSegmentIdentity, isNestedBfcacheSlotSegmentId, isNestedBfcacheSlotSegmentIdFor };