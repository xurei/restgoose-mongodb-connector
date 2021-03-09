import { RestgooseConnector, RestgooseModel, RestRequest, RestRegistry, RestError,
    ERROR_BAD_FORMAT_CODE, ERROR_NOT_FOUND_CODE, ERROR_VALIDATION_CODE } from '@xureilab/restgoose';
import * as mongoose from 'mongoose';
import { Connection, CastError, ValidationError, connection as defaultConnection, Document, Model } from 'mongoose';

type Constructor<T> = new(...args: any[]) => T;
export interface Dic {
    [key: string]: any;
}

export const isPrimitive = Type => !!Type && ['ObjectId', 'ObjectID', 'String', 'Number', 'Boolean', 'Date', 'Decimal128'].find(n => Type.name === n);
export const isArray = Type => !!Type && Type.name === 'Array';
export const isObject = Type => {
    let prototype = Type.prototype;
    let name = Type.name;
    while (name) {
        if (name === 'Object') {
            return true;
        }
        prototype = Object.getPrototypeOf(prototype);
        name = prototype ? prototype.constructor.name : null;
    }
    return false;
};
export const isObjectLitteral = Type => {
    const name = Type.name;
    return (name === 'Object');
};
export const isNumber = Type => !!Type && Type.name === 'Number';
export const isString = Type => !!Type && Type.name === 'String';
export const isBoolean = Type => !!Type && Type.name === 'Boolean';
export const isDate = Type => !!Type && Type.name === 'Date';

/*export async function getModel<T extends RestgooseModel>(modelEntry: RestModelEntry<T>, req: RestRequest): Promise<Model<T & Document>> {
    // FIXME as any
    const connection = modelEntry.restConfig.getConnection ? await modelEntry.restConfig.getConnection(req) as any : mongoose;
    const model = modelEntry.type;

    return getModelForConnection(model, connection);
}*/

const schemas = {};
function buildSchema<T extends RestgooseModel>(modelType: Constructor<T>, schemaOptions?) {
    const name = modelType.name;
    if (schemas[name]) {
        return schemas[name];
    }

    let sch: mongoose.Schema;
    const parentCtor = Object.getPrototypeOf(modelType);
    if (parentCtor && parentCtor.constructor.name !== 'RestgooseModel' && parentCtor.constructor.name !== 'Object') {
        const parentSchema = buildSchema(parentCtor, schemaOptions);
        sch = parentSchema.clone();
    }
    else {
        sch = schemaOptions ? new mongoose.Schema({}, schemaOptions) : new mongoose.Schema({});
    }

    const props = RestRegistry.listPropertiesOf(modelType as Constructor<RestgooseModel>);
    for (const prop of props) {
        if (!prop.config) {
            // TODO create a specific error class for Restgoose init errors
            throw new Error(`In ${name}: Property '${prop.name}' is missing a configuration. You probably forgot to add @prop() on it.`);
        }

        const config: Dic = {
            required: prop.config.required || false,
            index: prop.config.index || false,
            unique: prop.config.unique || false,
            default: prop.config.default,
        };
        if (prop.config.validate) {
            config.validate = prop.config.validate;
        }
        if (prop.config.enum) {
            if (typeof(prop.config.enum) === 'object') {
                config.enum = Object.keys(prop.config.enum).map(k => prop.config.enum[k]);
            }
            else {
                throw new Error(`In ${name}: Option 'enum' must be an array, object litteral, or enum type`);
            }
        }

        if (Array.isArray(prop.type)) {
            if (isPrimitive(prop.type[0])) {
                config.type = prop.type;
            }
            else if ((prop.config as any).ref === true) {
                config.type = [mongoose.Schema.Types.ObjectId];
            }
            else {
                const Type = prop.type[0] as Constructor<RestgooseModel>;
                const subSchema = buildSchema(Type); //No schemaOptions ??
                config.type = [subSchema];
            }
        }
        else if (!isPrimitive(prop.type) && !isArray(prop.type) && isObject(prop.type)) {
            if (isObjectLitteral(prop.type)) {
                config.type = Object;
            }
            else {
                const Type = prop.type as Constructor<RestgooseModel>;
                config.type = buildSchema(Type); //No schemaOptions ??
            }
        }
        else {
            config.type = prop.type;
        }

        const s = {};
        s[prop.name] = config;
        sch.add(s);
    }

    /*const indices = Reflect.getMetadata('typegoose:indices', t) || [];
    for (const index of indices) {
        sch.index(index.fields, index.options);
    }*/

    schemas[name] = sch;
    return sch;
}

async function getMongooseModel<T extends RestgooseModel>(model: Constructor<T>, connection?: Connection): Promise<Model<T & Document>> {
    if (!connection) {
        connection = defaultConnection;
    }

    if (!connection.models[model.name]) {
        // get schema of current model
        const schema = buildSchema(model);
        const newModel: Model<T & Document> = connection.model(model.name, schema);
        await newModel.init();
        await newModel.ensureIndexes();
        return newModel;
    }

    return connection.models[model.name];
}

function buildOneQuery(req: RestRequest, useFilter: boolean) {
    const restgooseReq = req.restgoose || {};
    const query = !useFilter ? {} : ( restgooseReq.query || {} );
    if (req.params && req.params.id) {
        return { $and: [
            { _id: req.params.id },
            query,
        ]} as any;
    }
    else {
        return query as any;
    }
}
export class RestgooseMongodbConnector implements RestgooseConnector {
    async findOne<T extends RestgooseModel> (modelType: Constructor<T>, req: RestRequest, useFilter: boolean): Promise<T> {
        const mongooseModel = await getMongooseModel(modelType);
        const query = buildOneQuery(req, useFilter);
        try {
            return Promise.resolve(await mongooseModel.findOne(query));
        }
        catch (e) {
            handleError(e);
        }
    }
    async find<T extends RestgooseModel> (modelType: Constructor<T>, req: RestRequest): Promise<T[]> {
        const mongooseModel = await getMongooseModel(modelType);
        const restgooseReq = req.restgoose || {};
        try {
            return mongooseModel.find(restgooseReq.query || {}, restgooseReq.projection, restgooseReq.options);
        }
        catch (e) {
            handleError(e);
        }

    }
    async deleteOne <T extends RestgooseModel> (modelType: Constructor<T>, req: RestRequest): Promise<boolean> {
        const mongooseModel = await getMongooseModel(modelType);
        const query = buildOneQuery(req, true);
        try {
            return mongooseModel.deleteOne(query).then(() => true);
        }
        catch (e) {
            handleError(e);
        }
    }
    async delete <T extends RestgooseModel> (modelType: Constructor<T>, req: RestRequest): Promise<boolean> {
        const mongooseModel = await getMongooseModel(modelType);
        const restgooseReq = req.restgoose || {};
        try {
            return mongooseModel.deleteMany(restgooseReq.query).then(() => true);
        }
        catch (e) {
            handleError(e);
        }
    }
    async create <T extends RestgooseModel> (modelType: Constructor<T>, req: RestRequest): Promise<T> {
        const mongooseModel = await getMongooseModel(modelType);
        try {
            return Promise.resolve(new mongooseModel());
        }
        catch (e) {
            handleError(e);
        }
    }
    async save <T extends RestgooseModel> (entity: T): Promise<T> {
        const mongooseEntity = entity as (T & Document);
        try {
            return await mongooseEntity.save();
        }
        catch (e) {
            handleError(e);
        }
    }
}

function handleError(error) {
    if (error) {
        if (error instanceof CastError) {
            error = error as CastError;
            // tslint:disable-next-line:no-string-literal
            if (error.path === '_id') {
                throw new RestError(404, {
                    code: ERROR_NOT_FOUND_CODE,
                });
            }
            else {
                throw new RestError(404, {
                    code: ERROR_BAD_FORMAT_CODE,
                    field: error.path,
                });
            }
        }
        else if (error.name === 'ValidationError') {
            error = error as ValidationError;
            // tslint:disable-next-line:no-string-literal
            throw new RestError(400, {
                code: ERROR_VALIDATION_CODE,
            });
        }
    }
}
