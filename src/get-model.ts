import { Connection, connection as defaultConnection, Document, Model } from 'mongoose';
import { RestgooseModel } from '@xureilab/restgoose';

type Constructor<T> = new(...args: any[]) => T;

/**
 * Get or builds the model for a specific connection
 * @param connection
 * @param model
 */
export function getModel<T extends RestgooseModel>(model: Constructor<T>, connection?: Connection): Model<T & Document> {
    if (!connection) {
        connection = defaultConnection;
    }

    if (!connection.models[model.name]) {
        // get schema of current model
        const schema = model.prototype.buildSchema();
        const newModel: Model<T & Document> = connection.model(model.name, schema);
        newModel.init();
        newModel.ensureIndexes();
        return newModel;
    }

    return connection.models[model.name];
}
