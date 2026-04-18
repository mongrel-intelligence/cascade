/**
 * `data-*` index-signature widener.
 *
 * @types/react 19 dropped the implicit `[key: ` + "`data-${string}`" + `]: unknown`
 * index signature from `HTMLAttributes<T>`. JSX has a separate code path
 * that still accepts `data-foo="bar"` on intrinsic/component elements,
 * but `createElement(Component, { 'data-foo': 'bar' })` no longer
 * typechecks under `strict: true` because the object literal is checked
 * against `React.ComponentProps<typeof Component>` which lacks the
 * widening index.
 *
 * Cast your props literal to `ComponentProps<typeof C> & DataProps` to
 * keep the `createElement` call strictly typed for everything else:
 *
 *     createElement(Button, {
 *         type: 'button',
 *         'data-action': 'create-webhook',
 *     } as React.ComponentProps<typeof Button> & DataProps)
 */
export type DataProps = { [key: `data-${string}`]: unknown };
