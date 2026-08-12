// placeholder until milestone M5/M6
const { endpoint, sendErr } = require('../../lib/http');
module.exports = endpoint(['GET','POST'], async (req,res)=>sendErr(res,501,'NOT_IMPLEMENTED','coming soon'));
