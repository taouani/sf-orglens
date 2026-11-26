/**
 * Reminds the billing contacts and the owners of invoices, as a job of its own.
 */
public with sharing class InvoiceReminderJob implements Queueable {
    private Set<Id> invoiceIds;

    public InvoiceReminderJob(Set<Id> invoiceIds) {
        this.invoiceIds = invoiceIds;
    }

    public void execute(QueueableContext context) {
        InvoiceNotifications notifications = new InvoiceNotifications();
        for (Invoice__c invoice : [
            SELECT Id, Name, Billing_Contact__c, OwnerId
            FROM Invoice__c
            WHERE Id IN :invoiceIds
        ]) {
            notifications.sendAll(invoice);
        }
    }
}
