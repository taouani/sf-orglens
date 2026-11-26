({
    init: function (component, event, helper) {
        helper.loadInvoices(component);
    },

    pay: function (component) {
        var action = component.get('c.pay');
        action.setParams({ invoiceId: component.get('v.recordId') });
        $A.enqueueAction(action);
    }
})
