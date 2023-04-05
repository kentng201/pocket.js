import { ValidDotNotationArray } from 'src/definitions/DotNotation';
import { ModelKey, ModelType, ModelValue } from 'src/definitions/Model';
import { APIResourceInfo } from 'src/manager/ApiHostManager';
import { DatabaseManager } from 'src/manager/DatabaseManager';
import { Model } from 'src/model/Model';
import { ApiRepo } from 'src/repo/ApiRepo';

const operators = ['=', '>', '>=', '<', '<=', '!=', 'in', 'not in', 'between', 'like',] as const;
export type Operator = typeof operators[number];
export type OperatorValue<T extends Model, Key extends keyof T, O extends Operator> =
    O extends 'in' ? ModelValue<T, Key>[]
    : O extends 'not in' ? ModelValue<T, Key>[]
    : O extends 'between' ? [ModelValue<T, Key>, ModelValue<T, Key>]
    : O extends 'like' ? string
    : ModelValue<T, Key>;
export type QueryableModel<T extends Model> = {
    [Key in ModelKey<T>]: OperatorValue<T, Key, Operator> | [Operator, OperatorValue<T, Key, Operator>];
};
export type QueryBuilderFunction<T extends Model> = (query: QueryBuilder<T>) => void;

function toMangoOperator(operator: Operator): string {
    if (operator === '=') return '$eq';
    if (operator === '!=') return '$ne';
    if (operator === '>') return '$gt';
    if (operator === '>=') return '$gte';
    if (operator === '<') return '$lt';
    if (operator === '<=') return '$lte';
    if (operator === 'in') return '$in';
    if (operator === 'not in') return '$nin';
    if (operator === 'between') return '$gte';
    if (operator === 'like') return '$regex';
    return '';
}
function toMangoQuery<T extends Model, Key extends ModelKey<T>, O extends Operator>(field: Key, operator: O, value: OperatorValue<T, Key, O>): PouchDB.Find.Selector {
    if (['=', '!=', '>', '>=', '<', '<=',].includes(operator)) {
        return { [field]: { [toMangoOperator(operator)]: value, }, };
    }
    if (['in', 'not in',].includes(operator)) {
        return { [field]: { [toMangoOperator(operator)]: value, }, };
    }
    if (operator === 'between') {
        const [fromValue, toValue,] = value as [ModelValue<T, Key>, ModelValue<T, Key>];
        return { [field]: { $gte: fromValue, $lte: toValue, }, };
    }
    if (operator === 'like') {
        return { [field]: { $regex: value, }, };
    }

    return {};
}
function queryableValueToValue<T extends Model, Key extends ModelKey<T>>(field: Key, value: ModelValue<T, Key>): PouchDB.Find.Selector {
    if (value instanceof Array && operators.includes(value[0])) {
        return toMangoQuery<T, Key, typeof value[0]>(field, value[0], value[1]);
    } else {
        return toMangoQuery<T, Key, '='>(field, '=', value);
    }
}

export enum RelationshipType {
    HAS_ONE = 'HAS_ONE',
    HAS_MANY = 'HAS_MANY',
    BELONGS_TO = 'BELONGS_TO',
    BELONGS_TO_MANY = 'BELONGS_TO_MANY',
}


export class QueryBuilder<T extends Model, K extends string[] = []> {
    protected queries: PouchDB.Find.FindRequest<T> & { selector: { $and: PouchDB.Find.Selector[] } };

    protected lastWhere?: ModelKey<T> | '$or';
    protected isOne?: boolean;
    protected modelClass: T;
    protected dbName?: string;
    protected relationships?: ValidDotNotationArray<T, K>;
    protected db: PouchDB.Database;
    protected apiInfo?: APIResourceInfo;
    public api?: ApiRepo<T>;

    protected relationshipType?: RelationshipType;
    protected localKey?: string;
    protected foreignKey?: string;

    constructor(modelClass: T, relationships?: ValidDotNotationArray<T, K>, dbName?: string, isOne?: boolean, apiInfo?: APIResourceInfo) {
        if (modelClass.cName === undefined) {
            throw new Error('QueryBuilder create error: collectionName not found');
        }
        this.dbName = dbName;
        this.modelClass = modelClass;
        this.relationships = (relationships || []) as ValidDotNotationArray<T, K>;
        this.queries = { selector: { $and: [], }, };
        this.isOne = isOne;
        this.db = DatabaseManager.get(this.dbName) as PouchDB.Database<T>;
        if (!this.db) throw new Error(`Database ${this.dbName} not found`);
        this.apiInfo = apiInfo;
        if (this.apiInfo) this.api = new ApiRepo<T>(this.apiInfo);
    }

    static query<T extends Model, K extends string[] = []>(modelClass: T, relationships?: ValidDotNotationArray<T, K>, dbName?: string) {
        return new this(modelClass, relationships, dbName, false) as QueryBuilder<T, K>;
    }

    static where<T extends Model, O extends Operator>(field: ModelKey<T>, operator: O, value: OperatorValue<T, ModelKey<T>, O>, modelClass: T) {
        const builder = this.query<T>(modelClass);
        return builder.where(field, operator, value);
    }

    raw() {
        return {};
    }

    setRelationshipType(type: RelationshipType, localKey: string, foreignKey: string) {
        this.relationshipType = type;
        this.localKey = localKey;
        this.foreignKey = foreignKey;
    }
    getRelationshipType() {
        return this.relationshipType;
    }
    getLocalKey() {
        return this.localKey;
    }
    getForeignKey() {
        return this.foreignKey;
    }

    async find(_id: string): Promise<T | undefined> {
        const doc = await this.db.get(_id);
        return this.cast(doc as ModelType<T>);
    }

    where(condition: (query: QueryBuilder<T>) => void): this;
    where(queryableModel: Partial<QueryableModel<T>>): this;
    where<Key extends ModelKey<T>>(field: Key, value: OperatorValue<T, Key, '='>): this;
    where<Key extends ModelKey<T>, O extends Operator>(field: Key, operator: O, value: OperatorValue<T, Key, O>): this;
    where<Key extends ModelKey<T>, O extends Operator>(...args: (ModelKey<T> | Operator | OperatorValue<T, Key, O>)[]) {
        if (args.length === 2) args = [args[0], '=', args[1],];

        if (args.length === 3) {
            const query = toMangoQuery<T, ModelKey<T>, O>(args[0] as Key, args[1] as O, args[2] as OperatorValue<T, Key, O>);
            this.queries.selector.$and.push(query);
            this.lastWhere = args[0] as ModelKey<T>;
            return this;
        } else {
            if (typeof args[0] === 'object') {
                Object.entries(args[0] as object).forEach(([key, value,]) => {
                    const query = queryableValueToValue<T, Key>(key as Key, value);
                    this.queries.selector.$and.push(query);
                });
                return this;
            }
            if (typeof args[0] === 'function') {
                this.whereCondition(args[0] as QueryBuilderFunction<T>, '$and');
                return this;
            }
        }
    }

    orWhere(condition: (query: QueryBuilder<T>) => void): this;
    orWhere(queryableModel: Partial<QueryableModel<T>>): this;
    orWhere<Key extends ModelKey<T>>(field: Key, value: OperatorValue<T, Key, '='>): this;
    orWhere<Key extends ModelKey<T>, O extends Operator>(field: Key, operator: Operator, value: OperatorValue<T, Key, O>): this;
    orWhere<Key extends ModelKey<T>, O extends Operator>(...args: (ModelKey<T> | Operator | OperatorValue<T, Key, O> | ModelType<T> | QueryableModel<T>)[]) {
        if (args.length === 2) args = [args[0], '=', args[1],];

        const queries = this.queries.selector.$and;
        const lastQueryIndex = queries.length - 1;
        const lastQuery = queries[lastQueryIndex];
        this.queries.selector.$and = this.queries.selector.$and.filter((_, i) => i !== lastQueryIndex);

        if (args.length === 3) {
            const [field, operator, value,] = args as [ModelKey<T>, O, OperatorValue<T, Key, O>];
            const newQuery = toMangoQuery(field, operator, value);
            if (this.lastWhere === '$or') {
                if (!lastQuery.$or) lastQuery.$or = [];
                lastQuery.$or.push(newQuery);
                this.queries.selector.$and.push(lastQuery);
            } else {
                if (!lastQuery) {
                    this.queries.selector.$and.push({ $or: [newQuery,], });
                } else {
                    this.queries.selector.$and.push({ $or: [lastQuery, newQuery,], });
                }
            }
            this.lastWhere = '$or';
            return this;
        } else {
            if (typeof args[0] === 'object') {
                Object.entries(args[0] as object).forEach(([key, value,]) => {
                    let operator: Operator, objectValue: OperatorValue<T, ModelKey<T>, Operator>;
                    if (value instanceof Array && operators.includes(value[0])) {
                        operator = value[0];
                        objectValue = value[1];
                    } else {
                        operator = '=';
                        objectValue = value;
                    }
                    this.orWhere(key as ModelKey<T>, operator, objectValue);
                });
                return this;
            }
            if (typeof args[0] === 'function') {
                this.whereCondition(args[0] as QueryBuilderFunction<T>, '$or');
                return this;
            }
        }
    }

    whereCondition(condition: QueryBuilderFunction<T> | Partial<ModelType<T>>, type: '$and' | '$or'): this {
        if (typeof condition === 'function') {
            const newQueryBuilder = new QueryBuilder<T, []>(this.modelClass, [] as ValidDotNotationArray<T, []>, this.dbName);
            (condition as QueryBuilderFunction<T>)(newQueryBuilder);
            this.queries.selector.$and = this.queries.selector.$and.concat(newQueryBuilder.queries.selector.$and || []);
        } else if (typeof condition === 'object') {
            Object.entries(condition).forEach(([key, value,]) => {
                let operator: Operator, objectValue: OperatorValue<T, ModelKey<T>, Operator>;
                if (value instanceof Array && operators.includes(value[0])) {
                    operator = value[0];
                    objectValue = value[1];
                } else {
                    operator = '=';
                    objectValue = value;
                }

                if (type == '$and') {
                    this.where(key as ModelKey<T>, operator, objectValue);
                } else {
                    this.orWhere(key as ModelKey<T>, operator, objectValue);
                }
                this.lastWhere = key as ModelKey<T>;
            });
        }
        return this;
    }


    sortBy(field: keyof T, order: 'asc' | 'desc') {
        if ((this.db as PouchDB.Database & { adapter: string }).adapter === 'memory') {
            return this;
        }
        if (!this.queries.sort) {
            this.queries.sort = [];
        }
        this.queries.sort.push({ [field]: order, });
        return this;
    }

    paginate(page: number, limit: number) {
        this.queries.limit = limit;
        this.queries.skip = (page - 1) * limit;
        return this;
    }

    getQuery() {
        return this.queries;
    }

    protected async bindRelationship(model: T) {
        if (this.relationships && model.relationships) {
            for (const r of this.relationships) {
                try {
                    if (r.includes('.')) {
                        const mainRelationship = r.split('.')[0];
                        const subRelationships = r.split('.').slice(1).join('.');
                        const mainModel = model[mainRelationship as keyof T] as Model | Model[];
                        if (mainModel && mainModel instanceof Model) {
                            // @ts-ignore
                            const newMainModel = await new QueryBuilder(mainModel as typeof Model, [subRelationships,], this.dbName)
                                // .sortBy('createdAt', 'asc')
                                .bindRelationship(mainModel);
                            // @ts-ignore
                            model[mainRelationship as keyof T] = newMainModel;
                        } else if (mainModel && mainModel instanceof Array) {
                            // @ts-ignore
                            const newMainModels = await Promise.all(mainModel.map(async (m) => await new QueryBuilder(m as typeof Model, [subRelationships,], this.dbName)
                                // .sortBy('createdAt', 'asc')
                                .bindRelationship(m)));
                            // @ts-ignore
                            model[mainRelationship as keyof T] = newMainModels;
                        }
                    } else {
                        const queryBuilder = await model.relationships[r as string]() as QueryBuilder<T>;
                        // queryBuilder.sortBy('createdAt', 'asc');
                        if (queryBuilder.isOne) {
                            Object.assign(model, { [r]: await queryBuilder.first(), });
                        } else {
                            Object.assign(model, { [r]: await queryBuilder.get(), });
                        }
                    }
                } catch (error) {
                    throw new Error(`Relationship "${r as string}" does not exists in model ${model.constructor.name}`);
                }
            }
        }
        return model;
    }

    protected async cast(item?: ModelType<T>): Promise<T | undefined> {
        if (!item) return;
        let model;
        try {
            // @ts-ignore
            model = new this.modelClass() as T;
        } catch (error) {
            // @ts-ignore
            model = new this.modelClass.constructor() as T;
        }
        model.fill(item);
        model._dirty = {};
        model = await this.bindRelationship(model);
        return model;
    }

    async get(): Promise<T[]> {
        this.queries.selector.$and.push({
            _id: { $regex: `^${this.modelClass.cName}`, },
        });
        const data = await DatabaseManager.get(this.dbName).find(this.queries);
        const result = [] as T[];
        for (const item of data.docs) {
            const model = await this.cast(item as unknown as ModelType<T>);
            if (model) result.push(model);
        }
        return result;
    }

    async first(): Promise<T | undefined> {
        this.isOne = true;
        const result = await this.get();
        return result[0];
    }

    async count() {
        return (await this.get()).length;
    }
}