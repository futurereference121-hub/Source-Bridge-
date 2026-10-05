/** Minimal NextRequest for the ticket route regression. Avoids loading Next server runtime. */
export class NextRequest extends Request {
  get nextUrl() {
    return new URL(this.url);
  }
}

export class NextResponse extends Response {
  static json(body, init) {
    return Response.json(body, init);
  }
}
