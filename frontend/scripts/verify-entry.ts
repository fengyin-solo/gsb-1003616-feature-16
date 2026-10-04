// 验证用入口：由 esbuild 打包成 ESM，导出全部要测的接口。
export {
  acceptReplant,
  arrangeReplant,
  effectivePlantingYear,
  markDegraded,
  mergeSpecies,
  reportGaps,
  firebeltStats,
} from '../src/api/firebelt-service'
export { listRows, readIdempotency, resetRows, syncFromStorage, takeIdempotency } from '../src/data/local-store'
