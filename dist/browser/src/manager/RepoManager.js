import { ApiHostManager } from './ApiHostManager';
import { QueryBuilder } from '..';
class RepoManager {
    static get(model) {
        var _a, _b, _c, _d, _e;
        const dbName = model.dName;
        const apiName = model.aName;
        const apiInfo = apiName ? ApiHostManager.getApiInfo(apiName) : {};
        const apiResourceInfo = Object.assign(Object.assign({}, apiInfo), { resource: model.aResource, apiAutoCreate: (_a = model.aAuto) === null || _a === void 0 ? void 0 : _a.create, apiAutoUpdate: (_b = model.aAuto) === null || _b === void 0 ? void 0 : _b.update, apiAutoDelete: (_c = model.aAuto) === null || _c === void 0 ? void 0 : _c.delete, apiAutoSoftDelete: (_d = model.aAuto) === null || _d === void 0 ? void 0 : _d.softDelete, apiFallbackGet: (_e = model.aAuto) === null || _e === void 0 ? void 0 : _e.fetchWhenMissing });
        const haveApiConfig = Object
            .keys(apiResourceInfo)
            .filter((attribute) => !!apiResourceInfo[attribute])
            .length > 0;
        return new QueryBuilder(model, undefined, dbName, undefined, haveApiConfig ? apiResourceInfo : undefined);
    }
}
RepoManager.repos = {};
export { RepoManager };
//# sourceMappingURL=RepoManager.js.map