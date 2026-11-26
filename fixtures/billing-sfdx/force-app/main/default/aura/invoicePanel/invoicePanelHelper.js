({
    loadInvoices: function (component) {
        var action = component.get('c.recentInvoices');
        action.setParams({ accountId: component.get('v.invoice.Account__c') });
        action.setCallback(this, function (response) {
            if (response.getState() === 'SUCCESS') {
                component.set('v.invoices', response.getReturnValue());
            } else {
                component.set('v.recordError', $A.get('$Label.c.Overdue_Notice'));
            }
        });
        $A.enqueueAction(action);
    }
})
