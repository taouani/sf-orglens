/**
 * Reads and writes invoices with static SOQL and plain field access.
 */
public with sharing class InvoiceService {
    public class InvoiceException extends Exception {}

    public static List<Invoice__c> openInvoices(Id accountId) {
        return [
            SELECT Id, Name, Amount__c, Due_Date__c,
                Account__r.Tier__c,
                (SELECT Quantity__c, Unit_Price__c FROM Lines__r WHERE Is_Billable__c = TRUE)
            FROM Invoice__c
            WHERE Account__c = :accountId
                AND Status__c != 'Paid'
            ORDER BY Due_Date__c DESC
            LIMIT 200
        ];
    }

    public static void markPaid(Id invoiceId) {
        Invoice__c invoice = [SELECT Id, Status__c, Paid_Date__c FROM Invoice__c WHERE Id = :invoiceId];
        if (invoice.Status__c == InvoiceConstants.STATUS_PAID) {
            throw new InvoiceException('The invoice is already paid.');
        }
        invoice.Status__c = InvoiceConstants.STATUS_PAID;
        invoice.Paid_Date__c = Date.today();
        update invoice;
    }

    public static Invoice__c createDraft(Account account, Decimal amount) {
        Invoice__c invoice = new Invoice__c(
            Account__c = account.Id,
            Amount__c = amount,
            Status__c = InvoiceConstants.STATUS_DRAFT
        );
        Decimal creditLimit = account.Credit_Limit__c;
        if (creditLimit != null && amount > creditLimit) {
            account.Risk_Score__c = 90;
        }
        insert invoice;
        return invoice;
    }

    public static Decimal totalDue(List<Invoice__c> invoices) {
        Decimal total = 0;
        for (Invoice__c invoice : invoices) {
            total += invoice.Total__c;
        }
        return total;
    }

    public static void raiseTax(Set<Id> invoiceIds, Decimal points) {
        List<Invoice__c> invoices = [SELECT Tax_Rate__c FROM Invoice__c WHERE Id IN :invoiceIds FOR UPDATE];
        for (Invoice__c invoice : invoices) {
            invoice.Tax_Rate__c += points;
        }
        update invoices;
    }

    public static Integer countByTier(String tier) {
        return [SELECT COUNT() FROM Invoice__c WHERE Account__r.Tier__c = :tier];
    }
}
