/**
 * The price of an invoice is the sum of its lines, less the discount of its account.
 */
public with sharing class StandardPricing extends InvoicePricing {
    public override Decimal price(Invoice__c invoice) {
        Decimal total = 0;
        for (Invoice_Line__c line : invoice.Lines__r) {
            total += price(line);
        }
        return round(total - total * discount(invoice.Account__r));
    }

    public override Decimal discount(Account account) {
        Decimal base = super.discount(account);
        return account.Is_Key_Account__c ? base + 0.05 : base;
    }

    public Decimal minimum() {
        return round(10);
    }
}
