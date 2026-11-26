/**
 * The controller of the page InvoiceList: the invoices that are not paid yet.
 */
public with sharing class InvoicePageController {
    public List<Invoice__c> invoices { get; private set; }

    public InvoicePageController() {
        invoices = [SELECT Id, Name, Amount__c, Total__c FROM Invoice__c WHERE Status__c != 'Paid' LIMIT 50];
    }

    public Decimal total() {
        return InvoiceService.totalDue(invoices);
    }
}
