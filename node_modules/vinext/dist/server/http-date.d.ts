//#region src/server/http-date.d.ts
/** Parse only the three HTTP-date wire formats accepted by RFC 9110. */
declare function parseHttpDate(value: string): number;
//#endregion
export { parseHttpDate };