/** @param {import('../../src/shared/script-contract').ScriptRunContext} ctx */
export async function run(ctx) {
  const greeting = ctx.env.GREETING ?? 'Hello'
  const target = ctx.params.TARGET ?? 'Autoforge'
  ctx.log('INFO', `${greeting}, ${target}!`)
  return { message: `${greeting}, ${target}!`, time: new Date().toISOString() }
}
