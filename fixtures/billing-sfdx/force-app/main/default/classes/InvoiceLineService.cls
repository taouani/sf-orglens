/**
 * Works on invoice lines. Status__c exists on the line and on the invoice.
 */
public with sharing class InvoiceLineService {
    public static void billLines(Id invoiceId) {
        List<Invoice_Line__c> lines = [
            SELECT Id, Status__c,
                Invoice__r.Status__c,
                Invoice__r.Account__r.Tier__c
            FROM Invoice_Line__c
            WHERE Invoice__c = :invoiceId
                AND Is_Billable__c = TRUE
        ];
        for (Invoice_Line__c line : lines) {
            if (line.Invoice__r.Status__c == InvoiceConstants.STATUS_PAID) {
                line.Status__c = 'Billed';
            }
        }
        update lines;
    }

    public static Decimal billableAmount(Invoice__c invoice) {
        Decimal amount = 0;
        for (Invoice_Line__c line : invoice.Lines__r) {
            if (line.Is_Billable__c) {
                amount += line.Quantity__c * line.Unit_Price__c;
            }
        }
        return amount;
    }

    public static Invoice_Line__c addLine(Invoice__c invoice, Decimal quantity, Decimal unitPrice) {
        Invoice_Line__c line = new Invoice_Line__c();
        line.Invoice__c = invoice.Id;
        line.Quantity__c = quantity;
        line.Unit_Price__c = unitPrice;
        line.Status__c = 'Open';
        insert line;
        return line;
    }

    public static String statusOf(SObject record) {
        if (record instanceof Invoice_Line__c) {
            return ((Invoice_Line__c) record).Status__c;
        }
        return ((Invoice__c) record).Status__c;
    }
}
