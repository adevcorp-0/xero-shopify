const XeroItemBill = require('../models/xeroItemBill.model');

exports.saveItemBill = async ({ itemCode, invoiceId, quantity, reference }) => {
  return await XeroItemBill.create({ itemCode, invoiceId, quantity, reference });
};

exports.getBillsForItem = async (itemCode) => {
  return await XeroItemBill.find({ itemCode });
};

exports.removeBill = async (invoiceId) => {
  return await XeroItemBill.deleteOne({ invoiceId });
};
