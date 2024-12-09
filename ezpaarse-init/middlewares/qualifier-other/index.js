'use strict';

/**
 * Check EC qualification
 */
module.exports = function qualifierOther() {
  return function qualifyOther(ec, next) {
    if (!ec || ec.rtype !== 'OTHER') { return next(); }

    var err  = new Error('EC not qualified');
    err.type = 'ENOTQUALIFIED';
    next(err);
  };
};
