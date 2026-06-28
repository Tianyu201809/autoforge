export type UnsavedChoice = 'save' | 'discard' | 'cancel'

export function promptUnsavedFiles(
  paths: string[],
  actionLabel: string,
  options: { allowStay?: boolean } = {}
): UnsavedChoice {
  if (!paths.length) return 'discard'

  const summary =
    paths.length === 1
      ? `「${paths[0]}」`
      : `${paths.length} 个文件（${paths.slice(0, 2).join('、')}${paths.length > 2 ? ' 等' : ''}）`

  const save = confirm(
    `${summary} 有未保存的更改。\n\n${actionLabel}前要保存吗？\n\n确定：保存\n取消：暂不保存`
  )
  if (save) return 'save'

  if (options.allowStay) {
    const discard = confirm(`放弃未保存的更改并${actionLabel}？\n\n确定：放弃更改\n取消：继续编辑`)
    if (discard) return 'discard'
    return 'cancel'
  }

  return 'discard'
}
