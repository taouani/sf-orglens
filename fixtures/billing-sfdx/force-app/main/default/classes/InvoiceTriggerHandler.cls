/**
 * What happens when invoices are saved.
 */
public with sharing class InvoiceTriggerHandler extends TriggerHandler {
    protected override void beforeInsert(List<SObject> records) {
        for (Invoice__c invoice : (List<Invoice__c>) records) {
            if (invoice.Due_Date__c == null) {
                invoice.Due_Date__c = Date.today().addDays(30);
            }
            if (String.isBlank(invoice.External_Id__c)) {
                invoice.External_Id__c = newExternalId();
            }
        }
    }

    protected override void beforeUpdate(List<SObject> records, Map<Id, SObject> oldRecords) {
        for (Invoice__c invoice : (List<Invoice__c>) records) {
            Invoice__c oldInvoice = (Invoice__c) oldRecords.get(invoice.Id);
            Boolean nowPaid = invoice.Status__c == InvoiceConstants.STATUS_PAID;
            Boolean wasPaid = oldInvoice.Status__c == InvoiceConstants.STATUS_PAID;
            if (nowPaid && !wasPaid) {
                invoice.Paid_Date__c = Date.today();
            }
        }
    }

    protected override void afterUpdate(List<SObject> records, Map<Id, SObject> oldRecords) {
        Set<Id> accountIds = new Set<Id>();
        for (Invoice__c invoice : (List<Invoice__c>) records) {
            Invoice__c oldInvoice = (Invoice__c) oldRecords.get(invoice.Id);
            Decimal oldAmount = oldInvoice.Amount__c;
            if (invoice.Amount__c != oldAmount) {
                accountIds.add(invoice.Account__c);
            }
        }
        if (!accountIds.isEmpty()) {
            refreshRisk(accountIds);
        }
    }

    private static void refreshRisk(Set<Id> accountIds) {
        List<Account> accounts = new List<Account>();
        for (AggregateResult row : [
            SELECT Account__c accountId, SUM(Amount__c) total
            FROM Invoice__c
            WHERE Account__c IN :accountIds
                AND Status__c != 'Paid'
            GROUP BY Account__c
            HAVING SUM(Amount__c) > 0
        ]) {
            Decimal total = (Decimal) row.get('total');
            Integer score = total > 100000 ? 90 : 10;
            accounts.add(new Account(Id = (Id) row.get('accountId'), Risk_Score__c = score));
        }
        update accounts;
    }

    private static String newExternalId() {
        return 'INV-' + String.valueOf(Crypto.getRandomInteger()).right(8);
    }
}
