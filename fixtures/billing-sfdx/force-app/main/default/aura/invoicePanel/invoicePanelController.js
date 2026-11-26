({
    init: function (component, event, helper) {
        helper.loadInvoices(component);
    },

    payInvoice: function (component) {
        var action = component.get('c.pay');
        action.setParams({ invoiceId: component.get('v.recordId') });
        $A.enqueueAction(action);
    }
})
