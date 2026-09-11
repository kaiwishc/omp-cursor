const runtime = globalThis as Record<string, unknown>;

runtime.document ??= {
	getElementById: () => null,
	createElement: () => ({ dataset: {}, textContent: "", className: "", appendChild: () => undefined }),
	documentElement: { dataset: {} },
	head: { appendChild: () => undefined },
};
runtime.localStorage ??= {
	getItem: () => null,
	setItem: () => undefined,
};
runtime.HTMLElement ??= class {};
runtime.customElements ??= { define: () => undefined, get: () => undefined };
runtime.window ??= { __OMP_SESSION_DATA__: { then: () => undefined } };
