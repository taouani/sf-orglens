/**
 * What the user interface calls.
 */
public with sharing class InvoiceController {
    @AuraEnabled(cacheable=true)
    public static List<Invoice__c> recentInvoices(Id accountId) {
        return [
            SELECT Id, Name, Summary__c, Account_Tier__c, Is_Mine__c
            FROM Invoice__c
            WHERE Account__c = :accountId
            WITH USER_MODE
            ORDER BY CreatedDate DESC
            LIMIT 20
        ];
    }

    @AuraEnabled
    public static void pay(Id invoiceId) {
        try {
            InvoiceService.markPaid(invoiceId);
        } catch (Exception error) {
            throw new AuraHandledException(error.getMessage());
        }
    }

    @AuraEnabled
    public static Invoice__c saveAmount(Id invoiceId, Decimal amount) {
        Invoice__c invoice = new Invoice__c(Id = invoiceId, Amount__c = amount);
        update as user invoice;
        return invoice;
    }
}
