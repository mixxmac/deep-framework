/**
 * Created by AlexanderC on 5/25/15.
 */
'use strict';

import {Interface} from '../../OOP/Interface';
import {Response} from './Response';
import {ErrorResponse} from './ErrorResponse';
import {Request} from './Request';
import {InvalidCognitoIdentityException} from './Exception/InvalidCognitoIdentityException';
import {MissingUserContextException} from './Exception/MissingUserContextException';
import {Context} from './Context';
import {Sandbox} from '../../Runtime/Sandbox';

/**
 * Lambda runtime context
 */
export class Runtime extends Interface {
  /**
   * @param {Object} kernel
   */
  constructor(kernel) {
    super(['handle']);

    this._kernel = kernel;
    this._request = null;
    this._context = null;

    this._loggedUserId = null;
    this._forceUserIdentity = false;
    this._contextSent = false;

    this._calleeConfig = null;

    this._fillDenyMissingUserContextOption();
  }

  /**
   * @returns {null|Context}
   */
  get context() {
    return this._context;
  }

  /**
   * @returns {Boolean}
   */
  get contextSent() {
    return this._contextSent;
  }

  /**
   * @returns {String}
   */
  get loggedUserId() {
    return this._loggedUserId;
  }

  /**
   * @returns {Boolean}
   */
  get forceUserIdentity() {
    return this._forceUserIdentity;
  }

  /**
   * @returns {Object}
   */
  get kernel() {
    return this._kernel;
  }

  /**
   * @returns {Function}
   */
  get lambda() {
    let _this = this;

    return function(event, context) {
      _this.run(event, context);
    };
  }

  /**
   * @param {String} schemaName
   * @param {Function} cb
   * @returns {Runtime}
   */
  validateInput(schemaName, cb) {
    let validation = this._kernel.get('validation');

    validation.validateRuntimeInput(this, schemaName, cb);

    return this;
  }

  /**
   * @param {Object} event
   * @param {Object} context
   * @returns {Runtime}
   */
  run(event, context) {
    this._context = new Context(context);
    this._request = new Request(event);

    new Sandbox(() => {
      this._fillUserContext();

      if (!this._loggedUserId && this._forceUserIdentity) {
        throw new MissingUserContextException();
      }

      let validationSchema = this.validationSchema;

      if (validationSchema) {
        let validationSchemaName = validationSchema;

        if (typeof validationSchema !== 'string') {
          let validation = this._kernel.get('validation');
          let setSchemaMethod = validationSchema.isJoi ? 'setSchema' : 'setSchemaRaw';

          validationSchemaName = `DeepHandlerValidation_${new Date().getTime()}`;

          validation[setSchemaMethod](validationSchemaName, validationSchema);
        }

        this.validateInput(validationSchemaName, this.handle);
      } else {
        this.handle(this._request);
      }
    })
      .fail((error) => {
        this.createError(error).send();
      })
      .run();

    return this;
  }

  /**
   * @param {String|Error|*} error
   */
  createError(error) {
    return new ErrorResponse(this, error);
  }

  /**
   * @param {Object} data
   */
  createResponse(data) {
    return new Response(this, data);
  }

  /**
   * @returns {null|Object}
   */
  get calleeConfig() {
    if (!this._calleeConfig) {
      if (this._context &&
        this._kernel &&
        this._context.has('invokedFunctionArn')) {

        let calleeArn = this._context.getOption('invokedFunctionArn');

        for (let microserviceKey in this._kernel.microservices) {
          if (!this._kernel.microservices.hasOwnProperty(microserviceKey)) {
            continue;
          }

          let microservice = this._kernel.microservices[microserviceKey];

          for (let resourceName in microservice.rawResources) {
            if (!microservice.rawResources.hasOwnProperty(resourceName)) {
              continue;
            }

            let rawActions = microservice.rawResources[resourceName];

            for (let actionName in rawActions) {
              if (!rawActions.hasOwnProperty(actionName)) {
                continue;
              }

              let actionMetadata = rawActions[actionName];

              if (actionMetadata.type === 'lambda' &&
                actionMetadata.source.original === calleeArn) {

                this._calleeConfig = actionMetadata;

                return this._calleeConfig;
              }
            }
          }
        }
      }

      // case something missing...
      if (this._context &&
        this._kernel) {

        this._calleeConfig = {};
      }
    }

    return this._calleeConfig;
  }

  /**
   * @returns {String}
   */
  get validationSchema() {
    return this.calleeConfig ? (this.calleeConfig.validationSchema || null) : null;
  }

  /**
   * @returns {Request}
   */
  get request() {
    return this._request;
  }

  /**
   * @returns {Object}
   */
  get securityService() {
    return this.kernel.get('security');
  }

  /**
   * @private
   */
  _fillDenyMissingUserContextOption() {
    if (this._kernel.config.hasOwnProperty('forceUserIdentity')) {
      this._forceUserIdentity = this._kernel.config.forceUserIdentity;
    }
  }

  /**
   * Retrieves logged user id from lambda context
   *
   * @private
   */
  _fillUserContext() {
    if (this._context &&
      this._context.has('identity') &&
      this._context.identity.hasOwnProperty('cognitoIdentityPoolId') &&
      this._context.identity.hasOwnProperty('cognitoIdentityId')
    ) {
      let identityPoolId = this._context.identity.cognitoIdentityPoolId;

      if (this.securityService.identityPoolId !== identityPoolId) {
        throw new InvalidCognitoIdentityException(identityPoolId);
      }

      // inject lambda context into security service
      // and instantiate security token without loading credentials
      this.securityService.warmupBackendLogin(this._context);

      this._loggedUserId = this._context.identity.cognitoIdentityId;
    }
  }
}
