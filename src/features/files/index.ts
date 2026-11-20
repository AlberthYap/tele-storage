// Public API — only these exports may be called by other features (currently: bot).
export {
  ingestFile,
  updateFileStorageRef,
  listCategories,
  listTags,
  createCategory,
  createTag,
  getOrCreateCategoryByThread,
  getOrCreateTagByName,
  updateCategoryThreadId,
} from "./service";
export { getFileByUniqueId } from "./queries";
